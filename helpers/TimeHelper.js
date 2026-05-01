const DefaultMaxTemporaryBanMs = 2 * 365 * 24 * 60 * 60 * 1000;

function ParseDuration(Input, Options = {}) {
    const ValueInput = String(Input ?? "").trim();

    if (ValueInput === "0") return 0;

    const Match = ValueInput.match(/^(\d+)([smhdwy])$/i);
    if (!Match) return null;

    const Value = Number.parseInt(Match[1], 10);
    const Unit = Match[2].toLowerCase();

    if (!Number.isSafeInteger(Value) || Value <= 0) return null;

    const Multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
        y: 365 * 24 * 60 * 60 * 1000
    };

    const Duration = Value * Multipliers[Unit];

    if (!Number.isSafeInteger(Duration) || Duration <= 0) return null;

    const MaxTemporaryMs = Options.maxTemporaryMs ?? DefaultMaxTemporaryBanMs;
    if (Duration >= MaxTemporaryMs) return 0;

    return Duration;
}

function NormalizeDurationInput(Input) {
    const ValueInput = String(Input ?? "").trim();
    if (ValueInput === "0") return "0";

    const Match = ValueInput.match(/^(\d+)([smhdwy])$/i);
    if (!Match) return null;

    return `${Number.parseInt(Match[1], 10)}${Match[2].toLowerCase()}`;
}

function ParsePunishmentLength(Input, Options = {}) {
    const ValueInput = String(Input ?? "").trim();

    if (Options.allowKick !== false && ValueInput.toLowerCase() === "kick") {
        return {
            action: "kick",
            durationMs: null,
            normalized: "kick"
        };
    }

    const DurationMs = ParseDuration(ValueInput, Options);
    if (DurationMs === null) return null;

    return {
        action: "ban",
        durationMs: DurationMs,
        normalized: NormalizeDurationInput(ValueInput)
    };
}

function FormatPunishmentLength(Input, Options = {}) {
    const Parsed = ParsePunishmentLength(Input, Options);
    if (!Parsed) return "Invalid";
    if (Parsed.action === "kick") return "Kick only";
    if (Parsed.durationMs === 0) return "Permanent ban";

    return `Temporary ban (${Parsed.normalized})`;
}

module.exports = {
    ParseDuration,
    NormalizeDurationInput,
    ParsePunishmentLength,
    FormatPunishmentLength
};
