import nodemailer from 'nodemailer';
import type { FeedbackConfig } from '../config.ts';

/** Un courriel prêt à partir vers l'exploitant. */
export interface OutgoingMail {
  subject: string;
  text: string;
  /** Adresse laissée par l'expéditeur, s'il veut une réponse. */
  replyTo: string | null;
}

export type SendMail = (mail: OutgoingMail) => Promise<void>;

/**
 * Envoi par SMTP authentifié, chez un service d'envoi (Resend, Brevo…). Le
 * serveur n'envoie jamais lui-même : un VPS a rarement le port 25 ouvert, et
 * ses courriels finiraient en indésirables faute de réputation.
 *
 * L'adresse de destination ne vit que dans la configuration du serveur : elle
 * n'apparaît ni dans la page, ni dans les réponses de l'API.
 */
export function smtpMailer(config: FeedbackConfig): SendMail {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    // Un service d'envoi lent ne doit pas tenir la requête indéfiniment.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return async ({ subject, text, replyTo }) => {
    await transport.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
  };
}
