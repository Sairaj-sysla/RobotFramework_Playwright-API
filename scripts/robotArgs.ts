/**
 * Builds the Robot Framework command line from user arguments. Robot requires
 * options before data sources, so user arguments are split using Robot's option
 * grammar: every option takes a value except the flags below (taken from
 * `robot --help`, Robot Framework 7.5) and their `--no` variants.
 */
const ROBOT_FLAGS = new Set([
  '--rpa', '--runemptysuite', '--legacyoutput', '-T', '--timestampoutputs', '--splitlog',
  '--nostatusrc', '--dryrun', '-X', '--exitonfailure', '--exitonerror', '--skipteardownonexit',
  '-.', '--dotted', '--quiet', '-h', '-?', '--help', '--version',
]);

function isFlag(option: string): boolean {
  return ROBOT_FLAGS.has(option) || (option.startsWith('--no') && ROBOT_FLAGS.has(`--${option.slice(4)}`));
}

export interface SplitArgs {
  options: string[];
  dataSources: string[];
}

export function splitRobotArgs(args: readonly string[]): SplitArgs {
  const options: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (!arg.startsWith('-') || arg === '-') break;
    if (arg.includes('=') || isFlag(arg)) {
      options.push(arg);
      index += 1;
    } else {
      options.push(arg, ...args.slice(index + 1, index + 2));
      index += 2;
    }
  }
  return { options, dataSources: args.slice(index) };
}

export interface RobotCommandOptions {
  resultsDir: string;
  defaultDataSource: string;
  /** Tag excluded unless the user's arguments mention it. */
  excludedByDefault: string;
}

export function buildRobotArgs(userArgs: readonly string[], options: RobotCommandOptions): string[] {
  const { options: userOptions, dataSources } = splitRobotArgs(userArgs);
  const args = ['-m', 'robot', '--outputdir', options.resultsDir];
  if (!userOptions.some((opt) => opt === '-L' || opt.startsWith('--loglevel'))) args.push('--loglevel', 'DEBUG:INFO');
  if (!userArgs.some((arg) => arg.includes(options.excludedByDefault))) args.push('--exclude', options.excludedByDefault);
  // User options come last so they override the defaults above (Robot uses the last value).
  return [...args, ...userOptions, ...(dataSources.length ? dataSources : [options.defaultDataSource])];
}
