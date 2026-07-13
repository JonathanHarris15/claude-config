// Example workflow — shows the shape. Invoke with: Workflow({name: 'adr-drift'})
//
// Checks whether the codebase still honours its own architecture decisions.
// One agent per ADR reads the decision and hunts for code that violates it;
// each claimed violation is then adversarially verified by a second agent
// before it reaches you, so you don't get a list of confident-sounding
// findings that evaporate when you open the file.

export const meta = {
  name: 'adr-drift',
  description: 'Find code that violates the ADRs it is supposed to follow',
  whenToUse: 'After a big feature lands, or before a refactor, to see where reality has drifted from the documented decisions.',
  phases: [
    { title: 'Check', detail: 'one agent per ADR, hunting for violations' },
    { title: 'Verify', detail: 'adversarially refute each claimed violation' },
  ],
}

const VIOLATIONS = {
  type: 'object',
  properties: {
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          decision: { type: 'string', description: 'the ADR rule being broken' },
          evidence: { type: 'string', description: 'what the code actually does' },
        },
        required: ['file', 'line', 'decision', 'evidence'],
      },
    },
  },
  required: ['violations'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if this is NOT a real violation' },
    why: { type: 'string' },
  },
  required: ['refuted', 'why'],
}

// `args` is whatever you passed as Workflow({args: ...}); default to the usual home.
const adrDir = args?.adrDir ?? 'docs/adr'

const index = await agent(
  `List every ADR file under ${adrDir}/. For each, return its path and a one-line summary of the decision it records. If the directory does not exist, return an empty array.`,
  {
    phase: 'Check',
    label: 'index ADRs',
    schema: {
      type: 'object',
      properties: {
        adrs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, decision: { type: 'string' } },
            required: ['path', 'decision'],
          },
        },
      },
      required: ['adrs'],
    },
  },
)

if (!index?.adrs?.length) {
  log(`No ADRs found under ${adrDir}/ — nothing to check.`)
  return { violations: [] }
}

log(`Checking ${index.adrs.length} ADRs against the codebase.`)

// pipeline, not parallel: an ADR's findings start verifying as soon as THAT
// ADR is done, instead of waiting for the slowest ADR to finish first.
const perAdr = await pipeline(
  index.adrs,

  (adr) =>
    agent(
      `Read ${adr.path}. It records this decision: "${adr.decision}".\n\n` +
        `Search the codebase for code that VIOLATES this decision. Only report a violation if you have read the actual code and can quote it. ` +
        `Do not report code that merely predates the ADR if the ADR grandfathers it. If the code fully honours the decision, return an empty array — ` +
        `an empty result is a perfectly good answer and is much better than a stretched one.`,
      { phase: 'Check', label: `check:${adr.path.split('/').pop()}`, schema: VIOLATIONS },
    ),

  (found, adr) =>
    parallel(
      (found?.violations ?? []).map((v) => () =>
        agent(
          `A previous agent claims this violates the ADR at ${adr.path}.\n\n` +
            `Claim: ${v.file}:${v.line} — ${v.evidence}\nRule: ${v.decision}\n\n` +
            `Open the file and try to REFUTE the claim. Maybe the code doesn't do what was described, maybe the ADR permits this case, ` +
            `maybe the line number is wrong. Default to refuted=true if you are uncertain.`,
          { phase: 'Verify', label: `verify:${v.file}`, effort: 'high', schema: VERDICT },
        ).then((verdict) => ({ ...v, adr: adr.path, verdict })),
      ),
    ),
)

const confirmed = perAdr
  .flat()
  .filter(Boolean)
  .filter((v) => v.verdict && !v.verdict.refuted)

log(`${confirmed.length} violations survived verification.`)
return { confirmed }
