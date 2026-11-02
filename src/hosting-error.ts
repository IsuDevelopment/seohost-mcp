export class HostingError extends Error {
  constructor(public readonly code: string, message: string) { super(message) }
}

// Only documented no-start responses may release a reserved provisioning plan.
export class TlsProvisionRejected extends HostingError {}
