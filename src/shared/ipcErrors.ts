// Main-process handlers already return safe user-facing errors. Remove only the
// transport prefix Electron adds; do not parse or display backend response bodies.
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(/^Error invoking remote method 'lt:[a-z]+': (?:Error: )?/, '');
}
