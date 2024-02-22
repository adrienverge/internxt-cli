import { Command, Flags, ux } from '@oclif/core';
import { AuthService } from '../services/auth.service';
import { ValidationService } from '../services/validation.service';
import { EmptyPasswordError, NotValidEmailError, NotValidTwoFactorCodeError } from '../types/login.types';
import { ConfigService } from '../services/config.service';
import { CLIUtils } from '../utils/cli.utils';

export default class Login extends Command {
  static readonly args = {};
  static readonly description =
    'Logs into an Internxt account. If the account is two-factor protected, then an extra code will be required.\n' +
    'Using the password parameter is not recommended as it can lead to security problems (the password is written plainly in the console), ' +
    'it is safer to type your password interactively when the cli asks for it.';

  static readonly examples = ['<%= config.bin %> <%= command.id %>'];

  static readonly flags = {
    email: Flags.string({
      char: 'e',
      env: 'INXT_EMAIL',
      description: 'The email to log in',
      required: false,
    }),
    password: Flags.string({
      char: 'p',
      env: 'INXT_PASSWORD',
      description: '[Insecure] The plain password to log in',
      required: false,
    }),
    'two-factor': Flags.string({
      char: 'w',
      env: 'INXT_TWOFACTORCODE',
      description: '[If needed] The two factor auth code',
      required: false,
      helpValue: '123456',
    }),
    'non-interactive': Flags.boolean({
      char: 'n',
      env: 'INXT_NONINTERACTIVE',
      helpGroup: 'helper',
      description:
        'Blocks the cli from being interactive. If passed, the cli will not request data through the console and will throw errors directly',
      required: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Login);

    const nonInteractive = flags['non-interactive'];
    const email = await this.getEmail(flags['email'], nonInteractive);
    const password = await this.getPassword(flags['password'], nonInteractive);

    const is2FANeeded = await AuthService.instance.is2FANeeded(email);
    let twoFactorCode: string | undefined;
    if (is2FANeeded) {
      twoFactorCode = await this.getTwoFactorCode(flags['two-factor'], nonInteractive);
    }

    const loginCredentials = await AuthService.instance.doLogin(email, password, twoFactorCode);
    await ConfigService.instance.saveUser(loginCredentials);
    CLIUtils.success(`Succesfully logged in to: ${loginCredentials.user.email}`);
  }

  async catch(error: Error) {
    CLIUtils.error(error.message);
    this.exit(1);
  }

  public getEmail = async (emailFlag: string | undefined, nonInteractive: boolean): Promise<string> => {
    let email = CLIUtils.getValueFromFlag(
      {
        value: emailFlag,
        name: Login.flags['email'].name,
        error: new NotValidEmailError(),
      },
      nonInteractive,
      ValidationService.instance.validateEmail,
    );
    if (!email) {
      email = await this.getEmailInteractively();
    }
    return email;
  };

  public getPassword = async (passwordFlag: string | undefined, nonInteractive: boolean): Promise<string> => {
    let password = CLIUtils.getValueFromFlag(
      {
        value: passwordFlag,
        name: Login.flags['password'].name,
        error: new EmptyPasswordError(),
      },
      nonInteractive,
      (password: string) => password.trim().length > 0,
    );
    if (!password) {
      password = await this.getPasswordInteractively();
    }
    return password;
  };

  public getTwoFactorCode = async (twoFactorFlag: string | undefined, nonInteractive: boolean): Promise<string> => {
    let twoFactor = CLIUtils.getValueFromFlag(
      {
        value: twoFactorFlag,
        name: Login.flags['two-factor'].name,
        error: new NotValidTwoFactorCodeError(),
      },
      nonInteractive,
      ValidationService.instance.validate2FA,
    );
    if (!twoFactor) {
      twoFactor = await this.getTwoFactorCodeInteractively();
    }
    return twoFactor;
  };

  // max of attempts to let the user rewrite their credentials in case of mistake
  private static readonly MAX_ATTEMPTS = 3;

  public getEmailInteractively = (): Promise<string> => {
    return CLIUtils.promptWithAttempts(
      {
        message: 'What is your email?',
        options: { required: true },
        error: new NotValidEmailError(),
      },
      Login.MAX_ATTEMPTS,
      ValidationService.instance.validateEmail,
    );
  };

  public getPasswordInteractively = (): Promise<string> => {
    return CLIUtils.promptWithAttempts(
      {
        message: 'What is your password?',
        options: { type: 'hide', required: true },
        error: new EmptyPasswordError(),
      },
      Login.MAX_ATTEMPTS,
      (password: string) => password.trim().length > 0,
    );
  };

  public getTwoFactorCodeInteractively = (): Promise<string> => {
    return CLIUtils.promptWithAttempts(
      {
        message: 'What is your two-factor token?',
        options: { type: 'mask', required: true },
        error: new NotValidTwoFactorCodeError(),
      },
      Login.MAX_ATTEMPTS,
      ValidationService.instance.validate2FA,
    );
  };
}
