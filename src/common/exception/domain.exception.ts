export class DomainException extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DomainException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
