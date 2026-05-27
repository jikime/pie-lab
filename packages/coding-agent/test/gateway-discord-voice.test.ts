import { describe, expect, it } from "vitest";
import { createWavBuffer, parseDiscordVoiceCommandText } from "../src/core/gateway/discord-voice.ts";
import type { DiscordAccountConfig } from "../src/core/gateway/chat/core/config-types.ts";

const account: DiscordAccountConfig = {
	service: "discord",
	botToken: "token",
	applicationId: "app",
	serverId: "guild",
	serverName: "Guild",
	botUserId: "bot-1",
	botUsername: "pie",
	channels: {},
};

describe("gateway discord voice helpers", () => {
	it("parses text voice commands with bot mentions stripped", () => {
		expect(parseDiscordVoiceCommandText("/voice join")).toBe("join");
		expect(parseDiscordVoiceCommandText("voice channel")).toBe("join");
		expect(parseDiscordVoiceCommandText("/voice leave")).toBe("leave");
		expect(parseDiscordVoiceCommandText("/voice status")).toBe("status");
		expect(parseDiscordVoiceCommandText("<@bot-1> /voice join", { account, botName: "pie" })).toBe("join");
		expect(parseDiscordVoiceCommandText("@pie voice off", { account, botName: "pie" })).toBe("leave");
	});

	it("wraps PCM data in a valid WAV container", () => {
		const pcm = Buffer.from([1, 2, 3, 4]);
		const wav = createWavBuffer(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });

		expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
		expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
		expect(wav.readUInt32LE(24)).toBe(16000);
		expect(wav.readUInt16LE(22)).toBe(1);
		expect(wav.readUInt32LE(40)).toBe(pcm.length);
		expect(wav.subarray(44)).toEqual(pcm);
	});
});
