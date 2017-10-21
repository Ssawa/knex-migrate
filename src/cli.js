import commander from 'commander';
import chalk from 'chalk';
import cliPkg from 'knex/package';
import minimist from 'minimist'
import tildify from 'tildify';
import Promise from 'bluebird';
import path from 'path';
import fs from 'fs';

const promiseFs = Promise.promisifyAll(fs);
const argv = minimist(process.argv.slice(2));

function exit(text) {
  if (text instanceof Error) {
    chalk.red(console.error(text.stack));
  } else {
    chalk.red(console.error(text));
  }
  process.exit(1);
}

function success(text) {
  console.log(text);
  process.exit(0);
}

function checkLocalModule(env) {
  if (!env.modulePath) {
    console.log(chalk.red('No local knex install found in:'), chalk.magenta(tildify(env.cwd)));
    exit('Try running: npm install knex.');
  }
}

function invoke(migrator, commander, env) {
  const filetypes = ['js', 'coffee', 'ts', 'eg', 'ls'];
  let pending = null;
  
  commander
    .version(
      chalk.blue('Knex CLI version: ', chalk.green(cliPkg.version)) + '\n' +
      chalk.blue('Local Knex version: ', chalk.green(env.modulePackage.version)) + '\n'
    )
    .option('--debug', 'Run with debugging.')
    .option('--knexfile [path]', 'Specify the knexfile path.')
    .option('--cwd [path]', 'Specify the working directory.')
    .option('--env [name]', 'environment, default: process.env.NODE_ENV || development');
  
  
  commander
    .command('init')
    .description('        Create a fresh knexfile.')
    .option(`-x [${filetypes.join('|')}]`, 'Specify the knexfile extension (default js)')
    .action(function() {
      const type = (argv.x || 'js').toLowerCase();
      if (filetypes.indexOf(type) === -1) {
        exit(`Invalid filetype specified: ${type}`);
      }
      if (env.configPath) {
        exit(`Error: ${env.configPath} already exists`);
      }
      checkLocalModule(env);
      const stubPath = `./knexfile.${type}`;
      pending = promiseFs.readFileAsync(
        path.dirname(env.modulePath) +
        '/lib/migrate/stub/knexfile-' +
        type + '.stub'
      ).then(function(code) { return promiseFs.writeFileAsync(stubPath, code) }).then(function() {
        success(chalk.green(`Created ${stubPath}`));
      }).catch(exit);
    });
  
  commander
    .command('migrate:make <name>')
    .description('        Create a named migration file.')
    .option(`-x [${filetypes.join('|')}]`, 'Specify the stub extension (default js)')
    .action(function(name) {
      const ext = (argv.x || env.configPath.split('.').pop()).toLowerCase();
      pending = migrator.make(name, {extension: ext}).then(function(name) {
        success(chalk.green(`Created Migration: ${name}`));
      }).catch(exit);
    });
  
  commander
    .command('migrate:latest')
    .description('        Run all migrations that have not yet been run.')
    .action(function() {
      pending = migrator.latest().spread(function(batchNo, log) {
        if (log.length === 0) {
          success(chalk.cyan('Already up to date'));
        }
        success(
          chalk.green(`Batch ${batchNo} run: ${log.length} migrations \n`) +
        chalk.cyan(log.join('\n'))
        );
      }).catch(exit);
    });
  
  commander
    .command('migrate:rollback')
    .description('        Rollback the last set of migrations performed.')
    .action(function() {
      pending = migrator.rollback().spread(function(batchNo, log) {
        if (log.length === 0) {
          success(chalk.cyan('Already at the base migration'));
        }
        success(
          chalk.green(`Batch ${batchNo} rolled back: ${log.length} migrations \n`) +
        chalk.cyan(log.join('\n'))
        );
      }).catch(exit);
    });
  
  commander
    .command('migrate:currentVersion')
    .description('        View the current version for the migration.')
    .action(function () {
      pending = migrator.currentVersion().then(function(version) {
        success(chalk.green('Current Version: ') + chalk.blue(version));
      }).catch(exit);
    });
  
  commander.parse(process.argv);
  
  Promise.resolve(pending).then(function() {
    commander.help();
  });
}

export { exit, success, checkLocalModule, argv, invoke };