declare module 'mic-recorder-to-mp3' {
  interface MicRecorderOptions {
    bitRate?: number;
  }

  interface MicRecorderStopResult {
    getMp3(): Promise<[BlobPart[], Blob]>;
  }

  export default class MicRecorder {
    constructor(options?: MicRecorderOptions);
    start(): Promise<void>;
    stop(): MicRecorderStopResult;
  }
}
