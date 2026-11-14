// A tiny flag parser shared by the kit's command-line tools. Flags are spelled out in each spec
// (`'--port': 'value'`) so a tool's accepted flags can be found by reading its source.

/** Splits argv into `{ positionals, flags }`. A spec value is 'value' (takes one) or 'bool'. Throws a sentence on anything else. */
export const parseFlags = (argv, spec) => {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const eq = arg.indexOf('=');
    const name = eq > -1 ? arg.slice(0, eq) : arg;
    const inline = eq > -1 ? arg.slice(eq + 1) : undefined;
    const kind = spec[name];
    if (!kind) throw new Error(`unknown flag ${name}`);
    if (kind === 'bool') {
      if (inline !== undefined) throw new Error(`${name} takes no value`);
      flags[name] = true;
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new Error(`${name} needs a value`);
    if (inline === undefined) i += 1;
    flags[name] = value;
  }
  return { positionals, flags };
};
