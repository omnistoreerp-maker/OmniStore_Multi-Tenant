/**
 * Ambient declarations for modules this runtime deliberately does NOT carry.
 *
 * Every one of these is a `declare module` for something reachable only from
 * code that was never copied here — the foundation's `src/build/**`, its tests,
 * its og-card rasteriser. They are kept as declarations rather than deleted
 * because a stray import of any of them must fail as a MISSING MODULE with a
 * name attached, not as a silent `any` nobody notices.
 */

/**
 * The analytics library, stubbed at resolution time by `vite.config.ts`.
 *
 * It is never installed: `loadPostHog()` awaits `import("posthog-js")`, the
 * bundler hands back an empty object instead, `ph?.capture` is not a function,
 * and analytics answers null — the path that already exists for "a blocker ate
 * it" or "the CDN 404'd". Declaring `default: unknown` rather than the real
 * PostHog surface keeps that honest: there is no API here to call, so the only
 * type that compiles is one you cannot use without narrowing first.
 */
declare module "posthog-js" {
  const posthog: unknown;
  export default posthog;
}
