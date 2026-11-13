// Strum release guard (firmware 0.53): ext byte 356. Pure code, tested on a PC (tests/host_map/strum_guard_test.c);
// input.c runs it on the raw strum samples in front of the per-switch debouncer.
// The strum bar can overshoot the centre when it is let go and briefly close the OPPOSITE microswitch. That is a
// different switch, so its own debouncer can't catch it. After a direction was physically released, a NEW press of the
// opposite direction is held back until G ms after that release. If the opposite switch is still closed when the guard
// ends it is accepted then (a real fast alternate strum is only delayed, a bounce shorter than the guard is dropped).
//   strum_guard byte: 0 = default (15 ms), 1..40 = ms, 255 = off
#ifndef YACC_STRUM_GUARD_H_
#define YACC_STRUM_GUARD_H_
#include <stdint.h>
#include <stdbool.h>

#define STRUM_GUARD_DEFAULT_MS 15
#define STRUM_GUARD_MAX_MS     40
#define STRUM_GUARD_OFF        255

typedef struct {
    uint32_t last_raw_us[2];   // [0] up, [1] down: last time the raw switch was seen closed
    bool armed[2];             // that direction was closed at some point and its release is still inside the guard
} strum_guard_t;

static inline bool strum_guard_valid(uint8_t cfg) { return cfg <= STRUM_GUARD_MAX_MS || cfg == STRUM_GUARD_OFF; }
// effective guard in ms for the config byte (0 = off)
static inline uint32_t strum_guard_ms(uint8_t cfg) {
    if (cfg == STRUM_GUARD_OFF) return 0;
    if (cfg == 0 || cfg > STRUM_GUARD_MAX_MS) return STRUM_GUARD_DEFAULT_MS;
    return cfg;
}

// raw_up / raw_down: the switches as sampled now. out_up / out_down: the debounced states (not touched here).
// Returns the raw values to feed the debouncers in *up / *down.
static inline void strum_guard_step(strum_guard_t *g, bool raw_up, bool raw_down, bool out_up, bool out_down,
                                    uint32_t now_us, uint32_t guard_ms, bool *up, bool *down) {
    const bool raw[2] = { raw_up, raw_down };
    const bool out[2] = { out_up, out_down };
    bool res[2] = { raw_up, raw_down };
    const uint32_t guard_us = guard_ms * 1000u;
    for (int d = 0; d < 2; d++) {
        if (raw[d]) { g->last_raw_us[d] = now_us; g->armed[d] = true; }
        else if (g->armed[d] && (guard_us == 0 || (uint32_t)(now_us - g->last_raw_us[d]) >= guard_us)) g->armed[d] = false;   // also keeps old stamps from wrapping into a window
    }
    if (guard_us != 0) {
        for (int d = 0; d < 2; d++) {
            int o = 1 - d;   // the opposite direction
            if (raw[d] && !out[d] && !raw[o] && g->armed[o] && (uint32_t)(now_us - g->last_raw_us[o]) < guard_us) res[d] = false;
        }
    }
    *up = res[0];
    *down = res[1];
}
#endif
