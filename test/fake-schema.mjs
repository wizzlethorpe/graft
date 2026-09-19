// Schema fields shaped like Foundry's, for asking whether a member stands as a document without Foundry.

/** A field Foundry cannot fill in: cleaning `undefined` leaves it invalid. */
export const required = { clean: (v) => v, validate: (v) => (v === undefined ? { failure: true } : undefined) };
/** A field with a default. */
export const filled = { clean: () => ({}), validate: () => undefined };
/** As Foundry's `system` field behaves when asked without its document. */
export const needsDocument = { clean: () => { throw new TypeError("Cannot read properties of undefined (reading 'documentType')"); }, validate: () => undefined };
