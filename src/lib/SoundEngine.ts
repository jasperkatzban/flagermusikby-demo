import {
	AudioContext
} from 'three';

var context = AudioContext.getContext();

export class Sound {
	url = '';
	buffer = null;
	numInstances = 0;

	constructor(url: any) {
		this.url = url;
	}

	load() {
		if (!this.url) return Promise.reject(new Error('Missing or invalid URL: ', this.url));
		if (this.buffer) return Promise.resolve(this.buffer);

		return new Promise((resolve, reject) => {
			const request = new XMLHttpRequest();
			request.open('GET', this.url, true);
			request.responseType = 'arraybuffer';

			// Decode asynchronously:
			request.onload = () => {
				context.decodeAudioData(request.response, (buffer) => {
					if (!buffer) {
						console.log(`Sound decoding error: ${this.url}`);
						reject(new Error(`Sound decoding error: ${this.url}`));

						return;
					}
					this.buffer = buffer;
					resolve(buffer);
				});
			};

			request.onerror = (err) => {
				console.log('Sound XMLHttpRequest error:', err);

				reject(err);
			};

			request.send();
		});
	}

	play(volume = 1, detune = 0) {
		if (!this.buffer) return;

		// Create a new sound source and assign it the loaded sound's buffer:
		const source: AudioBufferSourceNode = context.createBufferSource();
		source.buffer = this.buffer;

		source.onended = () => {
			source.stop(0);

			this.numInstances -= 1;
		};

		// Create a gain node with the desired volume:
		const gainNode = context.createGain();
		gainNode.gain.value = volume;

		// Connect nodes:
		source.connect(gainNode).connect(context.destination);

		// Detune audio
		source.detune.value = detune; // value in cents

		// Start playing at the desired time:
		source.start(0);

		this.numInstances += 1;
	}
}