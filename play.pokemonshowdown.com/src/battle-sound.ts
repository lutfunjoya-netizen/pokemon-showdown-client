import { Config, PS } from "./client-main";

export class BattleBGM {
	/**
	 * May be shared with other BGM objects: every battle has its own BattleBGM
	 * object, but two battles with the same music will have the same HTMLAudioElement
	 * object.
	 */
	sound?: HTMLAudioElement;
	url: string;
	timer: number | undefined = undefined;
	loopstart: number;
	loopend: number;
	/**
	 * When multiple battles with BGM are open, they will be `isPlaying`, but only the
	 * first one will be `isActuallyPlaying`. In addition, muting volume or setting
	 * BGM volume to 0 will set `isActuallyPlaying` to false.
	 */
	isPlaying = false;
	isActuallyPlaying = false;
	/**
	 * The sound should be rewound when it next plays.
	 */
	willRewind = true;
	constructor(url: string, loopstart: number, loopend: number) {
		this.url = url;
		this.loopstart = loopstart;
		this.loopend = loopend;
	}
	play() {
		this.willRewind = true;
		this.resume();
	}
	resume() {
		this.isPlaying = true;
		this.actuallyResume();
	}
	pause() {
		this.isPlaying = false;
		this.actuallyPause();
		BattleBGM.update();
	}
	stop() {
		this.pause();
		this.willRewind = true;
	}
	destroy() {
		BattleSound.deleteBgm(this);
		this.pause();
	}

	actuallyResume() {
		if (this !== BattleSound.currentBgm()) return;
		if (this.isActuallyPlaying) return;

		// BGM always plays at 1x speed, so playbackRate is 1
		if (!this.sound) this.sound = BattleSound.getSound(this.url, BattleSound.bgmVolume, 1);
		if (!this.sound) return;
		if (this.willRewind) this.sound.currentTime = 0;
		this.willRewind = false;
		this.isActuallyPlaying = true;
		this.sound.volume = BattleSound.bgmVolume / 100;
		this.sound.play();
		this.updateTime();
	}
	actuallyPause() {
		if (!this.isActuallyPlaying) return;
		this.isActuallyPlaying = false;
		this.sound!.pause();
		this.updateTime();
	}
	/**
	 * Handles the hard part of looping the sound
	 */
	updateTime() {
		clearTimeout(this.timer);
		this.timer = undefined;
		if (this !== BattleSound.currentBgm()) return;
		if (!this.sound) return;

		const progress = this.sound.currentTime * 1000;
		if (progress > this.loopend - 1000) {
			this.sound.currentTime -= (this.loopend - this.loopstart) / 1000;
		}

		this.timer = setTimeout(() => {
			this.updateTime();
		}, Math.max(this.loopend - progress, 1));
	}

	static update() {
		const current = BattleSound.currentBgm();
		for (const bgm of BattleSound.bgm) {
			if (bgm.isPlaying) {
				if (bgm === current) {
					bgm.actuallyResume();
				} else {
					bgm.actuallyPause();
				}
			}
		}
	}
}

export const BattleSound = new class {
	// Sound cache now includes playbackRate in the key
	soundCache: { [key: string]: HTMLAudioElement | undefined } = {};

	bgm: BattleBGM[] = [];

	// options
	effectVolume = 50;
	bgmVolume = 50;
	muted = false;

	/**
	 * Retrieves or creates an HTMLAudioElement.
	 * The cache key now incorporates the playbackRate to allow different speed versions of the same audio.
	 * @param url The URL of the sound file.
	 * @param initialVolume The initial volume (0-100) for the sound.
	 * @param initialPlaybackRate The initial playback rate (default is 1).
	 */
	getSound(url: string, initialVolume: number, initialPlaybackRate: number = 1) {
		if (!window.HTMLAudioElement) return;
		const cacheKey = `${url}-${initialPlaybackRate}`;
		if (this.soundCache[cacheKey]) {
			const sound = this.soundCache[cacheKey];
			if (sound) {
				// Ensure volume is correctly set for a cached sound
				sound.volume = initialVolume / 100;
				// Playback rate is part of the cache key, so it should already be correct
			}
			return sound;
		}
		try {
			const sound = document.createElement('audio');
			sound.src = `https://${Config.routes.client}/${url}`;
			sound.volume = initialVolume / 100;
			sound.playbackRate = initialPlaybackRate; // Set playback rate when created
			this.soundCache[cacheKey] = sound;
			return sound;
		} catch {}
	}

	playEffect(url: string) {
		// Effects typically play at 1x speed
		this.playSound(url, this.muted ? 0 : this.effectVolume, 1);
	}

	/**
	 * Plays a sound with a given URL, volume, and playback rate.
	 * @param url The URL of the sound file.
	 * @param volume The volume (0-100) for the sound.
	 * @param playbackRate The playback rate (default is 1).
	 */
	playSound(url: string, volume: number, playbackRate: number = 1) {
		if (!volume) return; // If volume is 0, don't play
		const effect = this.getSound(url, volume, playbackRate);
		if (effect) {
			effect.currentTime = 0; // Always rewind for one-shot effects like cries or standard effects
			effect.play();
		}
	}

	/**
	 * Plays a Pokémon's cry with appropriate speed and volume based on its fainted status and game generation.
	 * @param pokemonId The ID of the Pokémon (e.g., 'pikachu').
	 * @param isFainted True if the Pokémon is fainted, false otherwise.
	 * @param generation The game generation (e.g., 8, 9).
	 * @returns The calculated semitones for the cry's playback rate, or null if unable to play.
	 */
	playCry(pokemonId: string, isFainted: boolean, generation: number): number | null {
		if (!window.HTMLAudioElement || this.muted) return null;

		// Assuming cry files are located in a 'cries/' directory relative to the client base URL
		const cryUrl = `cries/${pokemonId}.mp3`;

		let playbackRate: number;
		if (isFainted) {
			// Fainting cries: 5/6x speed in Gen 1-8 and 3/4x speed in Gen 9+
			playbackRate = (generation >= 9) ? 3 / 4 : 5 / 6;
		} else {
			// Active Cries: 1x speed if Pokemon is not fainted
			playbackRate = 1;
		}

		const cryVolume = this.effectVolume; // Cries use the effect volume setting

		this.playSound(cryUrl, cryVolume, playbackRate); // Use playSound to handle playing and caching

		// Calculate and return the semitones
		return this.calculateSemitones(playbackRate);
	}

	/**
	 * Calculates the number of semitones from a given playback rate.
	 * Formula: 12 * log2(Playback Rate / 1)
	 * @param playbackRate The playback rate of the audio.
	 * @returns The number of semitones.
	 */
	calculateSemitones(playbackRate: number): number {
		return 12 * (Math.log2(playbackRate));
	}

	/** loopstart and loopend are in milliseconds */
	loadBgm(url: string, loopstart: number, loopend: number, replaceBGM?: BattleBGM | null) {
		if (replaceBGM) {
			replaceBGM.stop();
			this.deleteBgm(replaceBGM);
		}

		const bgm = new BattleBGM(url, loopstart, loopend);
		this.bgm.push(bgm);
		return bgm;
	}
	deleteBgm(bgm: BattleBGM) {
		const soundIndex = BattleSound.bgm.indexOf(bgm);
		if (soundIndex >= 0) BattleSound.bgm.splice(soundIndex, 1);
	}

	currentBgm() {
		if (!this.bgmVolume || this.muted) return false;
		for (const bgm of this.bgm) {
			if (bgm.isPlaying) return bgm;
		}
		return null;
	}

	// setting
	setMute(muted: boolean) {
		muted = !!muted;
		if (this.muted === muted) return;
		this.muted = muted;
		BattleBGM.update();
	}

	loudnessPercentToAmplitudePercent(loudnessPercent: number) {
		// 10 dB is perceived as approximately twice as loud
		let decibels = 10 * Math.log(loudnessPercent / 100) / Math.log(2);
		return 10 ** (decibels / 20) * 100;
	}
	setBgmVolume(bgmVolume: number) {
		this.bgmVolume = this.loudnessPercentToAmplitudePercent(bgmVolume);
		BattleBGM.update();
	}
	setEffectVolume(effectVolume: number) {
		this.effectVolume = this.loudnessPercentToAmplitudePercent(effectVolume);
	}
};

if (typeof PS === 'object') {
	PS.prefs.subscribeAndRun(key => {
		if (!key || key === 'musicvolume' || key === 'effectvolume' || key === 'mute') {
			// Note: PS.prefs.effectvolume and musicvolume are expected to be 0-100 'loudness percent'
			// and will be converted to 'amplitude percent' by the setters.
			BattleSound.setEffectVolume(PS.prefs.effectvolume);
			BattleSound.setBgmVolume(PS.prefs.musicvolume);
			BattleSound.setMute(PS.prefs.mute);
			// BattleBGM.update() is called by setBgmVolume and setMute
		}
	});
}
