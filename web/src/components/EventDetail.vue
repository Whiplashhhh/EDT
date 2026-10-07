<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { formatDayLong, formatDuration, formatMinutesSpan, formatTime, isoDay } from '../dates.js';
import { t } from '../i18n.js';
import { courseStyle } from '../colors.js';
import { departmentTag } from '../departments.js';

/*
 * Fiche d'un cours. La carte, elle, coupe ce qui ne tient pas — enseignants sur
 * un bloc étroit, groupes en vue semaine — : ici tout est dit, en clair, sans
 * dépendre de la place qu'avait la carte touchée.
 */
const props = defineProps({
  event: { type: Object, required: true },
  now: { type: Number, default: 0 },
  /* Sur l'emploi du temps d'une classe, sa formation va de soi : on ne la répète pas. */
  context: { type: String, default: 'groups' },
});
const emit = defineEmits(['close']);

/* Le focus va à la fiche, pas à sa croix : au doigt, un anneau sur le bouton
   fermer ferait croire qu'il est déjà choisi. */
const sheet = ref(null);
onMounted(() => nextTick(() => sheet.value?.focus()));

const tint = computed(() => courseStyle(props.event));
const day = computed(() => formatDayLong(isoDay(new Date(props.event.start))));
const teachers = computed(() => props.event.teachers ?? []);
const groups = computed(() => props.event.groups ?? []);
const notes = computed(() => props.event.notes ?? []);
const dept = computed(() => (props.context === 'groups' ? '' : departmentTag(props.event.department)));

const remaining = computed(() => {
  const start = new Date(props.event.start).getTime();
  const end = new Date(props.event.end).getTime();
  if (props.now < start || props.now >= end) return null;
  return t('card.remaining', { duration: formatMinutesSpan(Math.max(1, Math.round((end - props.now) / 60_000))) });
});
</script>

<template>
  <div class="sheet-wrap">
    <div class="backdrop" @click="emit('close')"></div>
    <div ref="sheet" class="sheet tinted" :style="tint" tabindex="-1" role="dialog" aria-modal="true" :aria-label="event.subject">
      <header class="head">
        <h2 class="subject">{{ event.subject }}</h2>
        <button class="close" type="button" :aria-label="t('feedback.close')" @click="emit('close')">✕</button>
      </header>

      <p class="when">
        <span class="day">{{ day }}</span>
        <span class="hours">
          <time :datetime="event.start">{{ formatTime(event.start) }}</time>
          –
          <time :datetime="event.end">{{ formatTime(event.end) }}</time>
          <span class="duration"> · {{ formatDuration(event.start, event.end) }}</span>
        </span>
        <span v-if="remaining" class="live">{{ remaining }}</span>
      </p>

      <p v-if="event.kind || dept" class="tags">
        <span v-if="event.kind" class="tag">{{ event.kind }}</span>
        <span v-if="dept" class="dept">{{ dept }}</span>
      </p>

      <dl v-if="event.room || teachers.length || groups.length" class="facts">
        <template v-if="event.room">
          <dt>{{ t('detail.room') }}</dt>
          <dd><b class="room">{{ event.room }}</b></dd>
        </template>
        <template v-if="teachers.length">
          <dt>{{ t('detail.teachers', { n: teachers.length }) }}</dt>
          <dd><ul><li v-for="name in teachers" :key="name">{{ name }}</li></ul></dd>
        </template>
        <template v-if="groups.length">
          <dt>{{ t('detail.groups', { n: groups.length }) }}</dt>
          <dd><ul><li v-for="name in groups" :key="name">{{ name }}</li></ul></dd>
        </template>
      </dl>

      <p v-if="notes.length" class="notes">{{ notes.join(' · ') }}</p>
      <p v-if="event.last" class="last"><span aria-hidden="true">⚠</span> {{ t('last.detail') }}</p>
    </div>
  </div>
</template>

<style scoped>
.sheet-wrap {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 1rem;
  padding-top: calc(1rem + var(--safe-top));
  padding-bottom: calc(1rem + var(--safe-bottom));
}
.backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(6px);
}

.sheet {
  position: relative;
  z-index: 1;
  width: min(26rem, 100%);
  max-height: min(85vh, 40rem);
  overflow-y: auto;
  padding: 1rem 1rem 1.1rem;
  background: color-mix(in srgb, var(--kind) var(--tint-bg), var(--bg-elevated));
  border: 1px solid color-mix(in srgb, var(--kind) 35%, var(--line));
  border-inline-start: 5px solid var(--kind);
  border-radius: var(--radius);
  box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
  animation: rise 0.18s ease-out;
  outline: none;
}

/* Sur téléphone, la fiche monte du bas de l'écran, là où le pouce la referme. */
@media (max-width: 599px) {
  .sheet-wrap { place-items: end stretch; padding: 0; }
  .sheet {
    width: 100%;
    padding-bottom: calc(1.2rem + var(--safe-bottom));
    border-inline-start-width: 1px;
    border-top: 5px solid var(--kind);
    border-radius: var(--radius) var(--radius) 0 0;
  }
}

@keyframes rise {
  from { transform: translateY(1rem); opacity: 0; }
  to { transform: none; opacity: 1; }
}

.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
.subject { margin: 0.15rem 0 0; font-size: 1.2rem; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.close {
  flex: none;
  width: 2.2rem; height: 2.2rem;
  margin: -0.3rem -0.4rem 0 0;
  display: grid; place-items: center;
  font-size: 1.1rem;
  color: var(--text-muted);
  border-radius: 999px;
}
.close:hover { background: var(--bg-sunken); color: var(--text); }

.when { margin: 0.5rem 0 0; display: flex; flex-direction: column; gap: 0.1rem; }
.day { font-size: 0.85rem; color: var(--text-muted); }
.day::first-letter { text-transform: uppercase; }
.hours { font-size: 1.05rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.duration { font-weight: 400; color: var(--text-muted); }
.live { font-size: 0.82rem; font-weight: 600; color: var(--kind); }

.tags { margin: 0.6rem 0 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.tag {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--kind);
  background: color-mix(in srgb, var(--kind) 22%, transparent);
}
.dept {
  padding: 0.05rem 0.45rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.facts {
  margin: 0.9rem 0 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.55rem 0.9rem;
  align-items: baseline;
}
.facts dt {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.facts ul { list-style: none; margin: 0; padding: 0; }
.facts li + li { margin-top: 0.15rem; }
.room {
  padding: 0.1rem 0.45rem;
  font-size: 1.05rem;
  font-weight: 750;
  background: color-mix(in srgb, var(--kind) 30%, transparent);
  border-radius: 6px;
}

.last { margin: 0.8rem 0 0; font-size: 0.88rem; font-weight: 600; color: var(--warn); }
.notes { margin: 0.8rem 0 0; font-size: 0.88rem; font-style: italic; color: var(--text-muted); overflow-wrap: anywhere; }
</style>
