<!--
  MarketingSection — pure presentational marketing + FAQ block.

  Renders below the wizard in App.svelte. Centered max-w-3xl. Contents:
    1. Why this tool exists       — one-paragraph framing
    2. Privacy                    — verifiable claim with DevTools call-out
    3. How to get your Polar      — numbered step list (mirrors README)
    4. FAQ                        — 6 collapsible <details> blocks
    5. Footer                     — repo link + license

  Uses native HTML <details>/<summary> for accessible no-JS collapsibles.
  No new shadcn components beyond what's already wired into the app.
-->
<script lang="ts">
  import { ExternalLink } from 'lucide-svelte'

  /**
   * AI usage cost surfaced in the FAQ. Sourced from Claude Code's `/usage`
   * panel as of 2026-06-03 ($354.39 cumulative across the entire project).
   * Kept as a prop with a baked-in default so the value is provable from
   * source without runtime fetches. Update by hand when /usage is
   * refreshed.
   */
  let { aiCostUsd = '~$355' }: { aiCostUsd?: string } = $props()
</script>

<section
  class="mx-auto max-w-3xl space-y-10 px-2 pb-12 pt-2 text-base leading-relaxed"
  data-testid="marketing-section"
>
  <!-- ── Why this tool exists ─────────────────────────────────────────── -->
  <div class="space-y-3">
    <h2 class="text-2xl font-semibold tracking-tight">Why this tool exists</h2>
    <p class="text-muted-foreground">
      Polar Flow's official Strava sync only forwards <em>new</em> activities going
      forward — anything you've already recorded in Polar stays trapped in the
      bulk export. Polar's web UI exports activities one at a time, and Strava
      only accepts FIT, TCX, or GPX uploads. This tool bridges the gap: drop
      your Polar bulk-export ZIP onto the page, get a ZIP of Strava-ready FIT
      files back — entirely in your browser, no server round-trip.
    </p>
  </div>

  <!-- ── Privacy ──────────────────────────────────────────────────────── -->
  <div class="space-y-3">
    <h2 class="text-2xl font-semibold tracking-tight">Privacy</h2>
    <p class="text-muted-foreground">
      Your data never leaves your browser. This is a static site with no
      backend, no analytics, and no logging — your ZIP is parsed and converted
      entirely on your machine.
    </p>
    <p class="text-muted-foreground">
      Open DevTools → Network tab <strong class="text-foreground">before</strong>
      you drop your ZIP. You'll see only same-origin asset fetches from the
      CDN: the initial page load, plus a few JavaScript chunks lazy-loaded as
      you progress through the wizard (the conversion engine, the stats
      module, the ZIP library — all code, no data). There are no requests to
      any third-party service, no requests carrying any of your training
      data, and no requests at all to Polar or Strava during conversion.
    </p>
  </div>

  <!-- ── How to get your Polar export ZIP ─────────────────────────────── -->
  <div class="space-y-3">
    <h2 class="text-2xl font-semibold tracking-tight">
      How to get your Polar export ZIP
    </h2>
    <ol class="list-decimal space-y-2 pl-6 text-muted-foreground">
      <li>
        Sign in at
        <a
          class="underline"
          href="https://flow.polar.com"
          target="_blank"
          rel="noreferrer">flow.polar.com</a
        >.
      </li>
      <li>
        Click your name (top-right) → <strong class="text-foreground">Settings</strong>
        → <strong class="text-foreground">Account</strong>.
      </li>
      <li>
        Scroll to <strong class="text-foreground">Export training data</strong>.
      </li>
      <li>
        Click <strong class="text-foreground">Request export</strong>. Polar
        emails a download link when ready (typically a few hours; up to a day
        for large datasets).
      </li>
      <li>
        Download the .zip from the email link. It's named
        <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs"
          >polar-user-data-export_&lt;uuid&gt;.zip</code
        > and is usually a few MB. Drop it onto the wizard above.
      </li>
    </ol>
  </div>

  <!-- ── FAQ ──────────────────────────────────────────────────────────── -->
  <div class="space-y-3">
    <h2 class="text-2xl font-semibold tracking-tight">FAQ</h2>
    <div class="space-y-2" data-testid="marketing-faq">
      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Why did you build this?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            Polar Flow's official Strava integration only forwards
            <em>new</em> activities going forward — anything you've already
            recorded in Polar stays trapped. Polar's web UI exports activities
            one at a time, and Strava only accepts FIT, TCX, or GPX uploads. So
            when you migrate from Polar to Strava you can sync future workouts
            with one click, but your past data has no path.
          </p>
          <p>
            This tool is the missing path: drop your Polar bulk-export ZIP, get
            Strava-ready FIT files back.
          </p>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Was AI used in building this?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            Yes — entirely. The conversion code, tests, web UI, deploy
            workflow, the CLI bundle, and this FAQ entry were all written by
            a Claude (Anthropic) agent under human direction. The maintainer
            never opened a code editor for any of it; every change was made
            via Claude Code through tool calls. Cumulative AI usage as of
            2026-06-03: <strong class="text-foreground">{aiCostUsd}</strong> —
            see <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs"
              >docs/WORK_LOG.md</code
            > for the per-task token / tool-use / cost breakdown.
          </p>
          <p>
            The full development log — every commit, the plan that drove the
            agent fan-outs, sub-agent telemetry, and a decisions log capturing
            every nontrivial trade-off — lives at
            <a
              class="underline"
              href="https://github.com/leewc/polar-to-strava-fit"
              target="_blank"
              rel="noreferrer">github.com/leewc/polar-to-strava-fit</a
            >. If that's a dealbreaker, don't use this tool — but you can audit
            every line yourself.
          </p>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Is there a CLI?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            Yes. Same converter module, byte-identical output, suitable for
            scripts and AI agents:
          </p>
          <p>
            <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm install -g github:leewc/polar-to-strava-fit</code>
            (installs from <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">main</code>),
            or grab a tagged tarball from the
            <a class="underline" href="https://github.com/leewc/polar-to-strava-fit/releases" target="_blank" rel="noreferrer">Releases page</a>.
            Then <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">polar-to-strava-fit ZIP OUT</code>.
          </p>
          <p>
            Three subcommands: <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">convert</code>,
            <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">inspect</code>, and
            <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">validate</code>.
            Full docs at
            <a class="underline" href="https://github.com/leewc/polar-to-strava-fit/blob/main/docs/CLI.md" target="_blank" rel="noreferrer">docs/CLI.md</a>
            in the repo.
          </p>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Wouldn't a manual shell script work better?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            Yes. A 200-line Python or Node script could do the same conversion
            with no UI at all, and that's exactly how this project started — see
            the <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">src/cli/</code>
            directory for <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">pnpm convert</code>,
            <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">pnpm inspect</code>, and
            <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">pnpm validate</code>.
          </p>
          <p>
            The reason this also exists as a webapp: most people moving from
            Polar to Strava aren't comfortable cloning a TypeScript repo,
            installing pnpm, and running CLI commands. The webapp is the same
            converter behind a drop zone, so non-technical folks have a path
            too. If you'd rather use the CLI, it's all there in the repo.
          </p>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Why FIT instead of TCX or GPX?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            Fidelity. TCX caps activity types at Running, Biking, and Other —
            every other Polar sport (swimming, hiking, strength, yoga, skiing,
            etc.) becomes "Other" in Strava and you'd manually re-classify each
            one. FIT supports the full sport catalog Polar publishes a mapping
            for, so a Polar "Trail running" lands in Strava as Trail Running,
            not Other.
          </p>
          <p>
            The tradeoff: FIT is binary (harder to debug if something goes
            wrong) and the SDK adds ~80 KB to the bundle. Both costs are worth
            the fidelity for a one-time historical backfill.
          </p>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          What about Strava's quality warnings?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>Strava runs its own checks on uploaded files. Three classes you may see:</p>
          <ul class="list-disc space-y-1.5 pl-5">
            <li>
              <strong class="text-foreground">"GPS had a bad day"</strong> — your
              original Polar tracking has a teleport between two adjacent records
              (a sensor glitch). The converter doesn't touch this; the source
              data is what's wrong. The activity uploads but won't get segment
              leaderboards. You can crop the bad segment in Strava if it
              matters.
            </li>
            <li>
              <strong class="text-foreground">"May be in a vehicle"</strong> —
              would be a converter bug. The converter divides Polar's km/h SPEED
              stream by 3.6 to produce FIT's m/s field; if Strava still flags
              vehicle pace something else is up. Please open an issue.
            </li>
            <li>
              <strong class="text-foreground">"Duplicate of activity X"</strong>
              — Strava dedups by start time. If you previously uploaded the same
              activity, the new upload is rejected. Harmless.
            </li>
          </ul>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Why isn't there a Polar→Strava login button?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            This tool runs entirely in your browser. Adding OAuth would mean
            talking to Strava's servers, which would mean uploading your data
            somewhere we'd then need to host. The privacy claim ("your data
            never leaves your browser") would no longer hold.
          </p>
          <p>
            For a one-time historical backfill, manually dragging FIT files to
            <a
              class="underline"
              href="https://www.strava.com/upload/select"
              target="_blank"
              rel="noreferrer">strava.com/upload/select</a
            > is fine — Strava's UI accepts batches of 25.
          </p>
        </div>
      </details>

      <details class="group rounded-md border bg-muted/20 p-3">
        <summary class="cursor-pointer font-medium">
          Can I run this offline?
        </summary>
        <div class="mt-2 space-y-2 text-muted-foreground">
          <p>
            Yes, after the first page load. The whole site is static plus a Web
            Worker; once your browser caches it, no network connection is needed
            for conversion. (A formal PWA / service-worker install is a future
            improvement.)
          </p>
        </div>
      </details>
    </div>
  </div>

  <!-- ── Footer ───────────────────────────────────────────────────────── -->
  <footer
    class="border-t pt-6 text-sm text-muted-foreground"
    data-testid="marketing-footer"
  >
    <ul class="space-y-1.5">
      <li>
        Open source on GitHub:
        <a
          class="underline"
          href="https://github.com/leewc/polar-to-strava-fit"
          target="_blank"
          rel="noreferrer"
        >
          leewc/polar-to-strava-fit
          <ExternalLink class="ml-0.5 inline size-3" aria-hidden="true" />
        </a>
      </li>
      <li>License: MIT</li>
      <li>Built by leewc with Claude</li>
    </ul>
  </footer>
</section>
