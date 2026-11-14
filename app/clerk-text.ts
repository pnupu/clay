/**
 * The words of the sign-in provider's own cards that name the application. Clerk fills them from the application's name
 * in its dashboard ("Sign in to <name>"); here they say Sorvi, through the provider's documented `localization` option
 * (ClerkProvider). Only these titles are set; every other text keeps the provider's wording.
 */
export const CLERK_TEXT = {
  signIn: { start: { title: "Sign in to Sorvi", titleCombined: "Sign in to Sorvi" } },
  signUp: { start: { title: "Create your Sorvi account", titleCombined: "Create your Sorvi account" } },
};
