import { aes } from '@internxt/lib';
import * as openpgp from 'openpgp';
import { ConfigService } from './config.service';
import {
  AesInit,
  BadEncodedPrivateKeyError,
  CorruptedEncryptedPrivateKeyError,
  KeysDoNotMatchError,
  WrongIterationsToEncryptPrivateKeyError,
} from '../types/keys.types';

export class KeysService {
  public static readonly instance: KeysService = new KeysService();

  /**
   * Validates if the private key can be decrypted with the password
   * @param privateKey The private key to validate encrypted
   * @param password The password used for encrypting the private key
   * @throws {BadEncodedPrivateKeyError} If the PLAIN private key is base64 encoded (known issue introduced in the past)
   * @throws {WrongIterationsToEncryptPrivateKeyError} If the ENCRYPTED private key was encrypted using the wrong iterations number (known issue introduced in the past)
   * @throws {CorruptedEncryptedPrivateKeyError} If the ENCRYPTED private key is un-decryptable (corrupted)
   * @async
   */
  public assertPrivateKeyIsValid = async (privateKey: string, password: string): Promise<void> => {
    let privateKeyDecrypted: string | undefined;

    let badIterations = true;
    try {
      aes.decrypt(privateKey, password, 9999);
    } catch {
      badIterations = false;
    }
    if (badIterations === true) throw new WrongIterationsToEncryptPrivateKeyError();

    let badEncrypted = false;
    try {
      privateKeyDecrypted = this.decryptPrivateKey(privateKey, password);
    } catch {
      badEncrypted = true;
    }

    let hasValidFormat = false;
    try {
      if (privateKeyDecrypted !== undefined) {
        hasValidFormat = await this.isValidKey(privateKeyDecrypted);
      }
    } catch {
      /* no op */
    }

    if (badEncrypted === true) throw new CorruptedEncryptedPrivateKeyError();
    if (hasValidFormat === false) throw new BadEncodedPrivateKeyError();
  };

  public encryptPrivateKey = (privateKey: string, password: string): string => {
    return aes.encrypt(privateKey, password, this.getAesInitFromEnv());
  };

  public decryptPrivateKey = (privateKey: string, password: string): string => {
    return aes.decrypt(privateKey, password);
  };

  /**
   * Validates if a message encrypted with the public key can be decrypted with the private key
   * @param privateKey The plain private key
   * @param publicKey The plain public key
   * @throws {KeysDoNotMatchError} If the keys can not be used together to encrypt/decrypt a message
   * @async
   */
  public assertValidateKeys = async (privateKey: string, publicKey: string): Promise<void> => {
    try {
      const publicKeyArmored = await openpgp.readKey({ armoredKey: publicKey });
      const privateKeyArmored = await openpgp.readPrivateKey({ armoredKey: privateKey });

      const plainMessage = 'validate-keys';
      const originalText = await openpgp.createMessage({ text: plainMessage });
      const encryptedMessage = await openpgp.encrypt({
        message: originalText,
        encryptionKeys: publicKeyArmored,
      });

      const decryptedMessage = (
        await openpgp.decrypt({
          message: await openpgp.readMessage({ armoredMessage: encryptedMessage }),
          verificationKeys: publicKeyArmored,
          decryptionKeys: privateKeyArmored,
        })
      ).data;

      if (decryptedMessage !== plainMessage) {
        throw new KeysDoNotMatchError();
      }
    } catch {
      throw new KeysDoNotMatchError();
    }
  };

  public isValidKey = async (key: string): Promise<boolean> => {
    try {
      await openpgp.readKey({ armoredKey: key });
      return true;
    } catch (error) {
      return false;
    }
  };

  /**
   * Generates pgp keys adding an AES-encrypted private key property by using a password
   * @param password The password for encrypting the private key
   * @returns The keys { privateKeyArmored, privateKeyArmoredEncrypted, publicKeyArmored, revocationCertificate }
   * @async
   */
  public generateNewKeysWithEncrypted = async (password: string) => {
    const { privateKey, publicKey, revocationCertificate } = await openpgp.generateKey({
      userIDs: [{ email: 'inxt@inxt.com' }],
      curve: 'ed25519',
    });

    return {
      privateKeyArmored: privateKey,
      privateKeyArmoredEncrypted: this.encryptPrivateKey(privateKey, password),
      publicKeyArmored: Buffer.from(publicKey).toString('base64'),
      revocationCertificate: Buffer.from(revocationCertificate).toString('base64'),
    };
  };

  public getAesInitFromEnv = (): AesInit => {
    const MAGIC_IV = ConfigService.instance.get('APP_MAGIC_IV');
    const MAGIC_SALT = ConfigService.instance.get('APP_MAGIC_SALT');

    return { iv: MAGIC_IV as string, salt: MAGIC_SALT as string };
  };
}
