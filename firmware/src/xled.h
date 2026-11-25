// Extra LED zones (firmware 0.56): neck, star, plus and body edge LEDs on the main chain or on up to three extra
// LED data pins. Pure helpers (no SDK), shared by the firmware and the host tests. Layout of the ext page bytes
// 358..400 is in ext_config.h, the spec in the repo notes.
#ifndef YACC_XLED_H_
#define YACC_XLED_H_

#include <stdint.h>
#include <stdbool.h>

#define MAX_CHAIN_LEDS 72          // longest chain: 18 fret / strum + 15 + 2 + 2 + 30, rounded up
#define NUM_XZONES 4
#define NUM_XCHAINS 4              // chain 0 = the main chain, 1..3 = xled_pin[0..2]

enum { XZ_NECK = 0, XZ_STAR, XZ_PLUS, XZ_BODY };
static const uint8_t XZ_MAX_COUNT[NUM_XZONES] = { 15, 2, 2, 30 };

enum { ZE_OFF = 0, ZE_SOLID, ZE_BREATHE, ZE_RAINBOW, ZE_CHASE, ZE_FRETS, ZE_FLASH, ZE_PRESS, ZE_SPARKLE, ZE_COUNT };

#define ZX_REVERSE 0x01
#define ZX_STAR    0x02
#define ZX_FLAGS_ALL 0x03

typedef struct __attribute__((packed)) {
    uint8_t count;       // +0 0 = off, else 1..max of the zone
    uint8_t chain;       // +1 0..3
    uint8_t start;       // +2 first position on the chain
    uint8_t flags;       // +3 ZX_*
    uint8_t effect;      // +4 ZE_*
    uint8_t speed;       // +5 128 = normal
    uint8_t color[3];    // +6..8
    uint8_t level;       // +9 1..100 % of the global brightness, 0 = 100 %
} xzone_t;
_Static_assert(sizeof(xzone_t) == 10, "xzone size");

// field ranges of one zone (an off zone only needs sane enums; its position is never used)
static inline bool xz_valid(int z, const xzone_t *x) {
    if (z < 0 || z >= NUM_XZONES) return false;
    if (x->count > XZ_MAX_COUNT[z] || x->chain >= NUM_XCHAINS) return false;
    if ((x->flags & ~ZX_FLAGS_ALL) || x->effect >= ZE_COUNT || x->level > 100) return false;
    if (x->count && (x->start >= MAX_CHAIN_LEDS || (unsigned)x->start + x->count > MAX_CHAIN_LEDS)) return false;
    return true;
}

// do two active zones share a chain position
static inline bool xz_overlap(const xzone_t *a, const xzone_t *b) {
    if (!a->count || !b->count || a->chain != b->chain) return false;
    return a->start < (unsigned)b->start + b->count && b->start < (unsigned)a->start + a->count;
}

// chain position of the zone's LED k (0 = the zone's "first" LED)
static inline int xz_pos(const xzone_t *x, int k) {
    return (x->flags & ZX_REVERSE) ? x->start + x->count - 1 - k : x->start + k;
}

// zone brightness 0..255 from the 1..100 % level (0 = 100 %)
static inline uint8_t xz_level(const xzone_t *x) { return x->level ? (uint8_t)(x->level * 255u / 100u) : 255; }

// animation rate in 1/128 units from the speed byte: 0 -> 0.25x, 128 -> 1x, 255 -> 4x
static inline uint32_t xz_rate(uint8_t speed) {
    return speed <= 128 ? 32u + speed * 96u / 128u : 128u + (speed - 128u) * 384u / 127u;
}

// Brightness ceiling with extra zones: `total` = fret + strum + all zone LEDs. More than 18 LEDs lowers the
// layout ceiling towards 255*18/total, but never below 48. Overdrive always gives 255.
static inline uint8_t xled_ceiling(uint8_t layout_ceiling, unsigned total, bool overdrive) {
    if (overdrive) return 255;
    if (total <= 18) return layout_ceiling;
    unsigned c = 255u * 18u / total;
    if (c < 48) c = 48;
    return c < layout_ceiling ? (uint8_t)c : layout_ceiling;
}

// ---- input driven effects (the animated ones live in rgb.c)
// ZE_FRETS: which held fret LED k of n shows; the held frets are spread evenly along the zone. -1 = none held.
static inline int xz_frets_pick(uint8_t held, int k, int n) {
    int idx[5], m = 0;
    for (int f = 0; f < 5; f++) if ((held >> f) & 1) idx[m++] = f;
    if (!m || n <= 0) return -1;
    return idx[k * m / n];
}

#define XZ_DIM 51   // 20 %: the idle level of the reactive effects

// One LED of ZE_SOLID / ZE_FRETS / ZE_PRESS / ZE_FLASH: fills col and returns the level 0..255.
// press = the zone's press source is held, flash = 0..255 strum flash amount, held = held frets mask (bit f).
static inline uint8_t xz_input_led(const xzone_t *x, int k, int n, const uint8_t fret_col[5][3], uint8_t held, bool press, uint8_t flash, uint8_t col[3]) {
    int f = -1;
    uint8_t lv = 255;
    switch (x->effect) {
        case ZE_PRESS: lv = press ? 255 : XZ_DIM; break;
        case ZE_FLASH: lv = (uint8_t)(XZ_DIM + (255 - XZ_DIM) * (unsigned)flash / 255u); break;
        case ZE_FRETS: f = xz_frets_pick(held, k, n); lv = f >= 0 ? 255 : XZ_DIM; break;
        default: break;
    }
    for (int i = 0; i < 3; i++) col[i] = f >= 0 ? fret_col[f][i] : x->color[i];
    return lv;
}

#endif
