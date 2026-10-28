// Bluetooth idle sleep (firmware 0.45): the decision logic, pure so it can be tested on a PC
// (tests/host_map/idle_sleep_test.c). The hardware side is in idle_sleep.c.
//
// "Idle" means no change on any digital input (frets, strum, star power, plus, D-pad, select, home, stick click) and
// no significant move of the whammy bar or the analog stick (more than 6 % of the range from where it was last
// counted as moved, so ADC noise doesn't keep the guitar awake). Tilt (the switch, the sensors and the
// accelerometer) does NOT count: a guitar lying on a table that gets nudged would otherwise never sleep.
#ifndef YACC_IDLE_SLEEP_H_
#define YACC_IDLE_SLEEP_H_
#include <stdint.h>
#include <stdbool.h>

#define IDLE_DEADBAND 1966          // 6 % of the whammy range 0..32767 (the stick, -32767..32767, gets twice that)
#define SLEEPWAKE_MAGIC 0x59534C50u // "YSLP" (watchdog scratch 0): restarted after an idle sleep, skip the hold-a-button boot shortcuts
#define BT_SLEEP_NEVER 255
#define BT_SLEEP_DEFAULT_MIN 2

typedef struct {
    uint32_t mask;                  // digital inputs at the last change
    int32_t  ana[3];                // whammy, stick X, stick Y at the last counted move
    uint32_t last_ms;               // when the last change happened
    bool     init;
} idle_t;

// ext byte 327: 0 = default (2 min), 1..60 minutes, 255 = never. Anything else is invalid.
static inline bool bt_sleep_valid(uint8_t v) { return v == 0 || (v >= 1 && v <= 60) || v == BT_SLEEP_NEVER; }
// Timeout in milliseconds, 0 = never (an invalid byte also never sleeps)
static inline uint32_t bt_sleep_timeout_ms(uint8_t v) {
    if (!bt_sleep_valid(v) || v == BT_SLEEP_NEVER) return 0;
    return (uint32_t)(v ? v : BT_SLEEP_DEFAULT_MIN) * 60000u;
}

static inline int32_t idle_abs(int32_t a) { return a < 0 ? -a : a; }

// Feed the current inputs. Returns true when this counted as activity (the timer restarted).
static inline bool idle_update(idle_t *s, uint32_t now_ms, uint32_t mask, int32_t whammy, int32_t sx, int32_t sy) {
    int32_t a[3] = { whammy, sx, sy };
    bool act = !s->init || mask != s->mask;
    for (int i = 0; i < 3 && !act; i++) if (idle_abs(a[i] - s->ana[i]) > (i ? 2 * IDLE_DEADBAND : IDLE_DEADBAND)) act = true;   // the stick spans twice the range
    if (act) {
        s->init = true; s->mask = mask; s->last_ms = now_ms;
        for (int i = 0; i < 3; i++) s->ana[i] = a[i];
    }
    return act;
}

// Not eligible (USB host, Bluetooth off, ...): keep the timer from running
static inline void idle_hold(idle_t *s, uint32_t now_ms) { s->last_ms = now_ms; }

// True once the guitar has been idle for the configured time
static inline bool idle_due(const idle_t *s, uint32_t now_ms, uint8_t cfg_byte) {
    uint32_t lim = bt_sleep_timeout_ms(cfg_byte);
    return lim && s->init && (uint32_t)(now_ms - s->last_ms) >= lim;
}

// Called every pass of the main loop. Does nothing on boards without Bluetooth.
void idle_sleep_task(void);
#endif
