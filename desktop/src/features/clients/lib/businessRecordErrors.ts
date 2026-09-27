export class BusinessRecordParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRecordParseError";
  }
}

export class BusinessRecordLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRecordLimitError";
  }
}
