// Tilt switch filter (firmware 0.51): ext bytes 354 (type) and 355 (settle time). Pure code, tested on a PC
// (tests/host_map/tilt_filter_test.c); input.c feeds it the raw tilt pin state (already inverted for a normally closed switch).
//   type 0, settle 0   mercury / generic, today's behaviour: input.c keeps its lockout debouncer (this filter is not used)
//   type 0, settle N   mercury / generic with an explicit settle time: the state follows the raw pin once it was stable for N ms
//   type 1             SW-520D ball switch: a short majority window with hysteresis (the ball rattles while strumming)
//                      in front of the same settle timer (default 40 ms)
#ifndef YACC_TILT_FILTER_H_
#define YACC_TILT_FILTER_H_
#include <stdint.h>
#include <stdbool.h>

#define TILT_FILTER_MAX_MS     250
#define TILT_TYPE_MERCURY      0
#define TILT_TYPE_SW520D       1
#define TILT_SW520D_DEFAULT_MS 40
#define TILT_SAMPLE_US         1000u   // majority window: one sample per ms, 8 samples
#define TILT_MAJ_ON            6       // 6 of the last 8 samples high -> high
#define TILT_MAJ_OFF           2       // 2 or fewer -> low, in between: keep (hysteresis)

typedef struct {
    bool out;             // filtered state
    bool init;
    bool maj;             // majority window output (SW-520D)
    bool cand;            // what `out` is waiting to become
    uint8_t hist;         // last 8 samples, 1 ms apart
    uint32_t last_sample; // time of the last sample
    uint32_t since;       // when `cand` last changed
} tilt_filter_t;

// true when the new filter replaces the legacy lockout debouncer
static inline bool tilt_filter_used(uint8_t type, uint8_t settle_ms) { return type != TILT_TYPE_MERCURY || settle_ms != 0; }
static inline uint32_t tilt_filter_settle_ms(uint8_t type, uint8_t settle_ms) {
    return settle_ms ? settle_ms : type == TILT_TYPE_SW520D ? TILT_SW520D_DEFAULT_MS : 0;
}

static inline unsigned tilt_popcount8(uint8_t v) { unsigned n = 0; while (v) { n += v & 1u; v >>= 1; } return n; }

static inline bool tilt_filter_step(tilt_filter_t *f, bool raw, uint32_t now_us, uint8_t type, uint8_t settle_ms) {
    if (!f->init) {
        f->init = true; f->out = f->cand = f->maj = raw;   // starts where the pin is (no settle wait at power up / when switched on live)
        f->hist = raw ? 0xFFu : 0; f->last_sample = now_us; f->since = now_us;
    }
    bool in = raw;
    if (type == TILT_TYPE_SW520D) {
        if ((uint32_t)(now_us - f->last_sample) >= TILT_SAMPLE_US) {
            f->last_sample = now_us;
            f->hist = (uint8_t)((f->hist << 1) | (raw ? 1u : 0u));
            unsigned n = tilt_popcount8(f->hist);
            if (n >= TILT_MAJ_ON) f->maj = true; else if (n <= TILT_MAJ_OFF) f->maj = false;
        }
        in = f->maj;
    }
    if (in != f->cand) { f->cand = in; f->since = now_us; }
    if (f->cand != f->out && (uint32_t)(now_us - f->since) >= tilt_filter_settle_ms(type, settle_ms) * 1000u) f->out = f->cand;
    return f->out;
}
#endif
