import type { GroupMessage, GroupMessenger } from "../types.ts";

// Keeps every group message in memory; in development the text is printed.
export class MockGroupMessenger implements GroupMessenger {
  readonly name = "mock-group-messenger";
  readonly sent: GroupMessage[] = [];

  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = () => {}) {
    this.log = log;
  }

  async send(message: GroupMessage): Promise<void> {
    this.sent.push(message);
    this.log(`[mock-group-messenger] ${message.text}${message.link ? ` ${message.link}` : ""}`);
  }
}
