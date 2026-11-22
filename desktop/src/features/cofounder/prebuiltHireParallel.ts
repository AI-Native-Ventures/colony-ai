/**
 * Starts the independent local persona preparation and relay head read
 * together. The caller still waits for both before it can publish a hire.
 */
export function materializePersonaAndReadHireHead<TPersona, THead>(input: {
  materializePersona: () => Promise<TPersona>;
  readHireHead: () => Promise<THead>;
}): Promise<[TPersona, THead]> {
  return Promise.all([input.materializePersona(), input.readHireHead()]);
}
