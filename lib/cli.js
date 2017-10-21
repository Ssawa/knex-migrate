'use strict';
const chalk = require('chalk');
const Liftoff = require('liftoff');
const cliPkg = require('knex/package');
const interpret = require('interpret');
const minimist = require('minimist');
const tildify = require('tildify');
const Promise = require('bluebird');
const path = require('path');
const fs = require('fs');
const Migrator = require('./');

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

function invoke(migratorFactory, commander, env, init = true) {
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
  
  if (init) {
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
  }
  
  commander
    .command('migrate:make <name>')
    .description('        Create a named migration file.')
    .option(`-x [${filetypes.join('|')}]`, 'Specify the stub extension (default js)')
    .action(function(name) {
      const ext = (argv.x || env.configPath ? env.configPath.split('.').pop() : 'js').toLowerCase();
      pending = migratorFactory().make(name, {extension: ext}).then(function(name) {
        success(chalk.green(`Created Migration: ${name}`));
      }).catch(exit);
    });
  
  commander
    .command('migrate:latest')
    .description('        Run all migrations that have not yet been run.')
    .action(function() {
      pending = migratorFactory().latest().spread(function(batchNo, log) {
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
      pending = migratorFactory().rollback().spread(function(batchNo, log) {
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
      pending = migratorFactory().currentVersion().then(function(version) {
        success(chalk.green('Current Version: ') + chalk.blue(version));
      }).catch(exit);
    });
  
  commander.parse(process.argv);
  
  Promise.resolve(pending).then(function() {
    commander.help();
  });
}

function bootstrap(configOrFactory) {
  const commander = require('commander');
  const cli = new Liftoff({
    name: 'knex',
    extensions: interpret.jsVariants,
    v8flags: require('v8flags')
  });
  
  cli.on('require', function(name) {
    console.log('Requiring external module', chalk.magenta(name));
  });
  
  cli.on('requireFail', function(name) {
    console.log(chalk.red('Failed to load external module'), chalk.magenta(name));
  });
  
  cli.launch({
    cwd: argv.cwd,
    configPath: argv.knexfile,
    require: argv.require,
    completion: argv.completion
  }, function (env) {
    if (typeof(configOrFactory) == 'function') {
      invoke(() => configOrFactory(env, commander), commander, env, true)
    } else {
      invoke(() => {
        const knex = require(env.modulePath);
        return new Migrator(knex(configOrFactory));
      }, commander, env, false)
    }
    
  });
}

module.exports = { exit, success, checkLocalModule, argv, invoke, bootstrap };