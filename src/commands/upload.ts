import { Command, Flags, ux } from '@oclif/core';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { NetworkFacade } from '../services/network/network-facade.service';
import { SdkManager } from '../services/sdk-manager.service';
import { AuthService } from '../services/auth.service';
import { CLIUtils } from '../utils/cli.utils';
import { ConfigService } from '../services/config.service';
import path from 'node:path';
import { DriveFileService } from '../services/drive/drive-file.service';
import { UploadService } from '../services/network/upload.service';
import { CryptoService } from '../services/crypto.service';

export default class Upload extends Command {
  static readonly description = 'Upload a file to Internxt Drive';

  static readonly examples = ['<%= config.bin %> <%= command.id %>'];
  static readonly enableJsonFlag = true;
  static readonly flags = {
    file: Flags.string({ description: 'The path to read the file in your system', required: true }),
    folderId: Flags.integer({ description: 'The folder id to upload the file to', required: false }),
  };

  static readonly args = {};

  public async run(): Promise<{ fileId: string }> {
    const { flags } = await this.parse(Upload);

    const stat = await fs.stat(flags.file);

    if (!stat.size) {
      throw new Error('File is empty, cannot upload empty files as is not allowed.');
    }

    if (!flags.folderId) {
      CLIUtils.warning('No folder id provided, uploading to root folder');
    }

    // 1. Prepare the network
    CLIUtils.doing('Preparing Network');
    const { mnemonic } = AuthService.instance.getAuthDetails();
    const user = await AuthService.instance.getUser();
    const networkModule = SdkManager.instance.getNetwork({
      user: user.bridgeUser,
      pass: user.userId,
    });
    const networkFacade = new NetworkFacade(networkModule, UploadService.instance, CryptoService.instance);

    CLIUtils.done();

    // 2. Upload file to the Network
    const fileStream = createReadStream(flags.file);
    const progressBar = ux.progress({
      format: 'Uploading file [{bar}] {percentage}%',
      linewrap: true,
    });
    progressBar.start(100, 0);
    const [uploadPromise, abortable] = await networkFacade.uploadFromStream(
      user.bucket,
      mnemonic,
      stat.size,
      fileStream,
      {
        progressCallback: (progress) => {
          progressBar.update(progress);
        },
      },
    );

    process.on('SIGINT', () => {
      abortable.abort('SIGINT received');
      process.exit(1);
    });

    const uploadResult = await uploadPromise;
    progressBar.stop();

    // 3. Create the file in Drive
    const fileInfo = path.parse(flags.file);
    const createdDriveFile = await DriveFileService.instance.createFile({
      name: fileInfo.name,
      type: fileInfo.ext.replaceAll('.', ''),
      size: stat.size,
      folderId: flags.folderId ?? user.root_folder_id,
      fileId: uploadResult.fileId,
      bucket: user.bucket,
    });

    CLIUtils.success(
      `File uploaded, view it at ${ConfigService.instance.get('DRIVE_URL')}/file/${createdDriveFile.uuid}`,
    );

    return uploadResult;
  }
}
