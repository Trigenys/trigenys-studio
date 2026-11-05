import type { Mail, Mailer } from "../types.ts";

// Keeps every message in memory. In development the magic link is printed
// so the flow can be exercised without a mail provider.
export class MockMailer implements Mailer {
  readonly name = "mock-mailer";
  readonly sent: Mail[] = [];

  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = () => {}) {
    this.log = log;
  }

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    this.log(`[mock-mailer] ${mail.template} -> ${mail.to}: ${mail.text}`);
  }
}
