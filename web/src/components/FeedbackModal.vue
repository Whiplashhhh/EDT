<script>
import { reactive } from 'vue';

/*
 * Le brouillon survit à la fermeture de la fenêtre : un clic à côté ne doit pas
 * coûter un message à moitié écrit. Il ne vit qu'en mémoire — rien de ce qu'on
 * tape ici n'est enregistré sur l'appareil — et s'efface une fois envoyé.
 */
const draft = reactive({ subject: '', message: '', email: '', status: '', name: '', withContext: true });

function clearDraft() {
  Object.assign(draft, { subject: '', message: '', email: '' });
}
</script>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';

const props = defineProps({
  /** `contact`, `suggestion` ou `bug` : le bouton qui a ouvert la fenêtre. */
  kind: { type: String, required: true },
  /** Ce que l'application sait de la situation : joint au message si on le laisse faire. */
  context: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const KINDS = ['contact', 'suggestion', 'bug'];
const STATUSES = ['student', 'teacher', 'staff', 'other'];
const MAX_SUBJECT = 120;
const MAX_MESSAGE = 4000;

const kind = ref(KINDS.includes(props.kind) ? props.kind : 'contact');
/** Champ piège : caché aux humains, rempli par les robots. */
const website = ref('');
const sending = ref(false);
const sent = ref(false);
const error = ref('');
const messageField = ref(null);

const canSend = computed(() => draft.message.trim().length >= 3 && !sending.value);

/* Ce qui sera joint, dit en clair : on ne transmet rien qu'on n'ait montré. */
const contextSummary = computed(() =>
  [props.context.identity, t('feedback.contextDevice')].filter(Boolean).join(' · '),
);

onMounted(() => nextTick(() => messageField.value?.focus()));

async function submit() {
  if (!canSend.value) return;
  sending.value = true;
  error.value = '';
  try {
    await api.sendFeedback({
      kind: kind.value,
      subject: draft.subject,
      message: draft.message,
      email: draft.email,
      status: draft.status || null,
      name: draft.name,
      context: draft.withContext ? props.context : null,
      website: website.value,
    });
    clearDraft();
    sent.value = true;
  } catch (err) {
    error.value = messageFor(err);
  } finally {
    sending.value = false;
  }
}

function messageFor(err) {
  if (err?.code === 'feedback-email' || err?.code === 'rate-limit' || err?.code === 'feedback-disabled') {
    return t(`error.${err.code}`);
  }
  // Une erreur de réseau n'a pas de code : le serveur n'a jamais répondu.
  return err?.code ? t('error.feedback-send') : t('error.network');
}
</script>

<template>
  <div class="gate">
    <div class="gate-backdrop" @click="emit('close')"></div>
    <div class="gate-card" role="dialog" aria-modal="true" :aria-label="t(`feedback.title.${kind}`)">
      <div class="gate-head">
        <h1 class="gate-title">{{ t(`feedback.title.${kind}`) }}</h1>
        <button class="icon" type="button" :aria-label="t('feedback.close')" @click="emit('close')">✕</button>
      </div>

      <div v-if="sent" class="done" role="status">
        <p class="done-text"><span aria-hidden="true">✓</span> {{ t('feedback.sent') }}</p>
        <button class="primary" type="button" @click="emit('close')">{{ t('feedback.close') }}</button>
      </div>

      <form v-else class="form" novalidate @submit.prevent="submit">
        <div class="segmented" role="group" :aria-label="t('feedback.kind')">
          <button
            v-for="k in KINDS"
            :key="k"
            type="button"
            :class="{ on: kind === k }"
            :aria-pressed="kind === k"
            @click="kind = k"
          >{{ t(`feedback.kind.${k}`) }}</button>
        </div>
        <p class="hint">{{ t(`feedback.hint.${kind}`) }}</p>

        <label class="field">
          <span class="label">{{ t('feedback.subject') }}</span>
          <input v-model="draft.subject" class="input" type="text" :maxlength="MAX_SUBJECT" autocomplete="off" />
        </label>

        <label class="field">
          <span class="label">{{ t('feedback.message') }}</span>
          <textarea
            ref="messageField"
            v-model="draft.message"
            class="input area"
            rows="5"
            :maxlength="MAX_MESSAGE"
            required
          ></textarea>
          <span v-if="draft.message.length > MAX_MESSAGE * 0.8" class="counter">{{ draft.message.length }} / {{ MAX_MESSAGE }}</span>
        </label>

        <label class="field">
          <span class="label">{{ t('feedback.email') }}</span>
          <input v-model="draft.email" class="input" type="email" inputmode="email" autocomplete="email" maxlength="254" />
          <span class="note">{{ t('feedback.emailHint') }}</span>
        </label>

        <details class="about" :open="Boolean(draft.status || draft.name)">
          <summary>{{ t('feedback.about') }}</summary>
          <div class="about-fields">
            <label class="field">
              <span class="label">{{ t('feedback.status') }}</span>
              <select v-model="draft.status" class="input">
                <option value="">—</option>
                <option v-for="s in STATUSES" :key="s" :value="s">{{ t(`feedback.status.${s}`) }}</option>
              </select>
            </label>
            <label class="field">
              <span class="label">{{ t('feedback.name') }}</span>
              <input v-model="draft.name" class="input" type="text" maxlength="80" autocomplete="name" />
            </label>
          </div>
        </details>

        <label class="toggle">
          <input v-model="draft.withContext" type="checkbox" />
          <span class="toggle-text">
            <span class="toggle-title">{{ t('feedback.context') }}</span>
            <span class="note">{{ contextSummary }}</span>
          </span>
        </label>

        <!-- Piège à robots : hors de l'écran, hors du parcours au clavier, ignoré des lecteurs d'écran. -->
        <div class="trap" aria-hidden="true">
          <label>Website <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off" /></label>
        </div>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button class="primary" type="submit" :disabled="!canSend">
          {{ sending ? t('feedback.sending') : t('feedback.send') }}
        </button>
        <p class="note privacy">{{ t('feedback.privacy') }}</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 1rem;
  padding-top: calc(1rem + var(--safe-top));
  padding-bottom: calc(1rem + var(--safe-bottom));
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(10px);
}
.gate-backdrop { position: absolute; inset: 0; }

.gate-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(28rem, 100%);
  min-width: 0;
  max-height: min(92vh, 46rem);
  overflow-y: auto;
  padding: 1rem 0.9rem 0.9rem;
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
}

.gate-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.gate-title { margin: 0; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.icon {
  flex: none;
  width: 2.2rem; height: 2.2rem;
  display: grid; place-items: center;
  font-size: 1.1rem;
  color: var(--text-muted);
  border-radius: 999px;
}
.icon:hover { background: var(--bg-sunken); color: var(--text); }

.form { display: flex; flex-direction: column; gap: 0.75rem; }

.segmented {
  display: flex;
  padding: 2px;
  background: var(--bg-sunken);
  border-radius: 999px;
}
.segmented button {
  flex: 1;
  padding: 0.35rem 0.5rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
  border-radius: 999px;
  white-space: nowrap;
}
.segmented button:hover { color: var(--text); }
.segmented button.on { color: var(--accent); background: var(--bg-elevated); box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); }

.hint { margin: -0.2rem 0 0; font-size: 0.82rem; line-height: 1.45; color: var(--text-muted); }

.field { position: relative; display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
.input {
  width: 100%;
  padding: 0.55rem 0.65rem;
  font: inherit;
  /* 16 px : en dessous, Safari zoome sur le champ à la saisie. */
  font-size: 16px;
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }
.area { resize: vertical; min-height: 7rem; line-height: 1.45; }
.counter { align-self: flex-end; font-size: 0.72rem; color: var(--text-muted); }
.note { font-size: 0.72rem; line-height: 1.4; color: var(--text-muted); }

.about { border: 1px solid var(--line); border-radius: var(--radius-sm); }
.about summary {
  padding: 0.55rem 0.7rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}
.about[open] summary { color: var(--text); }
.about-fields { display: flex; flex-direction: column; gap: 0.6rem; padding: 0 0.7rem 0.7rem; }

.toggle { display: flex; align-items: flex-start; gap: 0.6rem; cursor: pointer; }
.toggle input { flex: none; width: 1.05rem; height: 1.05rem; margin: 0.15rem 0 0; accent-color: var(--accent); }
.toggle-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.toggle-title { font-size: 0.88rem; }

.trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }

.error { margin: 0; font-size: 0.83rem; color: var(--danger); }

.primary {
  padding: 0.65rem;
  font-weight: 600;
  color: var(--bg);
  background: var(--accent);
  border-radius: var(--radius-sm);
}
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.privacy { margin: -0.3rem 0 0; text-align: center; }

.done { display: flex; flex-direction: column; gap: 0.9rem; padding: 0.5rem 0 0; }
.done-text { margin: 0; font-size: 0.95rem; line-height: 1.45; }
.done-text span { color: var(--accent); font-weight: 700; }
</style>
