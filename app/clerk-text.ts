/**
 * The words of the sign-in provider's own cards that name the application. Clerk fills them from the application's name
 * in its dashboard ("Sign in to <name>"); here they say Clay, through the provider's documented `localization` option
 * (ClerkProvider). Only these titles are set; every other text keeps the provider's wording.
 */
export const CLERK_TEXT = {
  signIn: { start: { title: "Sign in to Clay", titleCombined: "Sign in to Clay" } },
  signUp: { start: { title: "Create your Clay account", titleCombined: "Create your Clay account" } },
};
