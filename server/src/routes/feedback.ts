import type { FastifyInstance } from 'fastify';
import {
  bodyText,
  isBot,
  parseFeedback,
  subjectLine,
  type DepartmentInfo,
  type FeedbackBody,
} from '../feedback/message.ts';
import type { SendMail } from '../feedback/mailer.ts';

/**
 * Contact, suggestions et signalements de problème.
 *
 * Le message part du formulaire de l'application, et c'est le serveur qui le
 * transmet par courriel à l'exploitant : personne n'a à connaître son adresse,
 * ni à donner la sienne. Rien n'est conservé ici — le message est relayé, puis
 * oublié.
 */

export interface FeedbackRoutesOptions {
  /** Envoi du courriel, ou `null` si l'installation n'a pas de SMTP configuré. */
  send: SendMail | null;
  /** Nom et ville d'une formation, d'après ADE ; `null` si on ne la connaît pas. */
  describeDepartment: (id: string) => Promise<DepartmentInfo | null>;
  /** Plafond d'envois par adresse IP et par heure. */
  maxPerHour?: number;
}

export async function registerFeedbackRoutes(app: FastifyInstance, opts: FeedbackRoutesOptions): Promise<void> {
  const { send, describeDepartment, maxPerHour = 5 } = opts;

  // Sans SMTP, l'application n'affiche pas le formulaire : inutile d'écrire un message qui ne partira pas.
  app.get('/feedback/config', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { enabled: Boolean(send) };
  });

  app.post<{ Body: FeedbackBody }>(
    '/feedback',
    {
      // En plus de la limite générale : quelques messages par heure suffisent à un humain.
      config: { rateLimit: { max: maxPerHour, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      if (!send) {
        throw Object.assign(new Error('Le formulaire de contact n’est pas activé sur ce serveur.'), {
          statusCode: 503,
          code: 'feedback-disabled',
        });
      }
      const body = req.body ?? {};

      // Un robot reçoit la même réponse qu'un humain : rien ne lui apprend qu'il a été repéré.
      if (isBot(body)) return reply.code(204).send();

      const feedback = parseFeedback(body);
      const department = feedback.context?.department
        ? await describeDepartment(feedback.context.department).catch(() => null)
        : null;

      try {
        await send({
          subject: subjectLine(feedback),
          text: bodyText(feedback, department, new Date()),
          replyTo: feedback.email,
        });
      } catch (err) {
        req.log.error({ err }, 'envoi du message de contact impossible');
        throw Object.assign(new Error('Le message n’a pas pu être envoyé.'), {
          statusCode: 503,
          code: 'feedback-send',
        });
      }
      req.log.info({ kind: feedback.kind }, 'message de contact transmis');
      return reply.code(204).send();
    },
  );
}
