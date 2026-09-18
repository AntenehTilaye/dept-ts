// Transactional mail entry point for the platform. Rendering (React email templates) lives in
// src/lib/mail so this service stays framework-free; the generic notification mailer with
// templates, channel deliveries and the worker queue arrives in the scheduler phase.
export {
  sendPasswordMail,
  type PasswordMailInput,
  type PasswordMailKind,
} from "../../lib/mail/password-mail";
