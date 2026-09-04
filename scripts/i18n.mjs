/** Localised text: a key, or a key and the values its message interpolates. */
export const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
