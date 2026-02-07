class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const inputChannels = inputs[0];
    const outputChannels = outputs[0];

    if (inputChannels && inputChannels[0]) {
      const mono = inputChannels[0].slice();
      this.port.postMessage(mono);
    }

    if (outputChannels) {
      for (let i = 0; i < outputChannels.length; i += 1) {
        outputChannels[i].fill(0);
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
