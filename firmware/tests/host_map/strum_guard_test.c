// Host test for the strum release guard (strum_guard.h, ext byte 356). cc -I../../src strum_guard_test.c ../../src/ext_config.c
#include <stdio.h>
#include <string.h>
#include "strum_guard.h"
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

// Simulation: poll every 100 us. Raw switch states come from time windows [start, end) in us. The debounced outs are the
// guard's output, unfiltered, which is the worst case for the guard (the real debouncers only delay it further).
typedef struct { uint32_t s, e; } win_t;
static bool in_win(const win_t *w, int n, uint32_t t) { for (int i = 0; i < n; i++) if ((uint32_t)(t - w[i].s) < (uint32_t)(w[i].e - w[i].s)) return true; return false; }

typedef struct { uint32_t up_on, up_off, dn_on, dn_off; bool up_seen, dn_seen; bool up_end, dn_end; } res_t;

// t0: start time (can be near the wrap), total_us simulated. up / down: raw windows (absolute times, wrap-safe).
static res_t sim(uint32_t t0, uint32_t total_us, const win_t *up, int nu, const win_t *dn, int nd, uint8_t cfg) {
    strum_guard_t g; memset(&g, 0, sizeof g);
    res_t r; memset(&r, 0, sizeof r);
    bool ou = false, od = false;
    for (uint32_t i = 0; i <= total_us; i += 100) {
        uint32_t t = t0 + i;
        bool gu, gd;
        strum_guard_step(&g, in_win(up, nu, t), in_win(dn, nd, t), ou, od, t, strum_guard_ms(cfg), &gu, &gd);
        if (gu && !ou && !r.up_seen) { r.up_seen = true; r.up_on = i; }
        if (gd && !od && !r.dn_seen) { r.dn_seen = true; r.dn_on = i; }
        ou = gu; od = gd;
    }
    r.up_end = ou; r.dn_end = od;
    return r;
}
#define MS(x) ((uint32_t)((x) * 1000))

static void scenarios(uint32_t base, const char *tag) {
    (void)tag;
    // down held 100..300 ms, released at 300 ms
    win_t dn[1] = { { base + MS(100), base + MS(300) } };
    // 1. bounce of 3 ms on up, 2 ms after the release: dropped
    { win_t up[1] = { { base + MS(302), base + MS(305) } };
      res_t r = sim(base, MS(500), up, 1, dn, 1, 0);
      CHECK(r.dn_seen && !r.up_seen && !r.up_end); }
    // 2. real up press starting 5 ms after the release, held 50 ms: accepted at release + 15 ms
    { win_t up[1] = { { base + MS(305), base + MS(355) } };
      res_t r = sim(base, MS(500), up, 1, dn, 1, 0);
      CHECK(r.up_seen && r.up_on >= MS(314.8) && r.up_on <= MS(315.3)); }
    // 3. press starting 20 ms after the release: accepted immediately
    { win_t up[1] = { { base + MS(320), base + MS(370) } };
      res_t r = sim(base, MS(500), up, 1, dn, 1, 0);
      CHECK(r.up_seen && r.up_on == MS(320)); }
    // 4. guard off (255): the bounce passes, and so does the very first press after the release
    { win_t up[1] = { { base + MS(302), base + MS(305) } };
      res_t r = sim(base, MS(500), up, 1, dn, 1, 255);
      CHECK(r.up_seen && r.up_on == MS(302)); }
    // 5. custom 30 ms: a press 20 ms after the release is held until 30 ms, one 35 ms after is not delayed
    { win_t up[1] = { { base + MS(320), base + MS(380) } };
      res_t r = sim(base, MS(500), up, 1, dn, 1, 30);
      CHECK(r.up_seen && r.up_on >= MS(329.8) && r.up_on <= MS(330.3));
      win_t up2[1] = { { base + MS(335), base + MS(380) } };
      r = sim(base, MS(500), up2, 1, dn, 1, 30);
      CHECK(r.up_seen && r.up_on == MS(335));
      win_t up3[1] = { { base + MS(320), base + MS(327) } };   // 7 ms bounce, shorter than 30 ms: dropped
      r = sim(base, MS(500), up3, 1, dn, 1, 30); CHECK(!r.up_seen); }
    // 6. same-direction re-press right after the release is not affected
    { win_t dn2[2] = { { base + MS(100), base + MS(300) }, { base + MS(302), base + MS(340) } };
      res_t r = sim(base, MS(500), NULL, 0, dn2, 2, 0);
      CHECK(r.dn_seen && r.dn_end == false);
      // count down presses
      strum_guard_t g; memset(&g, 0, sizeof g); bool od = false; int presses = 0;
      for (uint32_t i = 0; i <= MS(500); i += 100) {
          uint32_t t = base + i; bool gu, gd;
          strum_guard_step(&g, false, in_win(dn2, 2, t), false, od, t, 15, &gu, &gd);
          if (gd && !od) presses++;
          od = gd;
      }
      CHECK(presses == 2); }
    // 7. both held stays both: up pressed first and held, then down pressed while up is still physically held
    { win_t up[1] = { { base + MS(100), base + MS(300) } };
      win_t dn3[1] = { { base + MS(150), base + MS(300) } };
      res_t r = sim(base, MS(500), up, 1, dn3, 1, 0);
      CHECK(r.up_seen && r.dn_seen && r.dn_on == MS(150));
      // both pressed together from the start
      win_t b[1] = { { base + MS(100), base + MS(200) } };
      r = sim(base, MS(500), b, 1, b, 1, 0);
      CHECK(r.up_seen && r.dn_seen && r.up_on == MS(100) && r.dn_on == MS(100)); }
    // 8. an already debounced-pressed direction is never suppressed, even when the opposite releases and re-closes
    { strum_guard_t g; memset(&g, 0, sizeof g); bool u, d;
      strum_guard_step(&g, false, true, false, false, base, 15, &u, &d);          // down closes
      strum_guard_step(&g, false, false, false, true, base + 1000, 15, &u, &d);      // down released
      strum_guard_step(&g, true, false, true, false, base + 1500, 15, &u, &d);       // up already out = true
      CHECK(u); }
}

int main(void) {
    CHECK(strum_guard_ms(0) == 15 && strum_guard_ms(1) == 1 && strum_guard_ms(40) == 40 && strum_guard_ms(255) == 0);
    CHECK(strum_guard_valid(0) && strum_guard_valid(1) && strum_guard_valid(40) && strum_guard_valid(255));
    CHECK(!strum_guard_valid(41) && !strum_guard_valid(100) && !strum_guard_valid(254));

    // nothing was ever pressed: no suppression (power up with the opposite switch closed)
    { strum_guard_t g; memset(&g, 0, sizeof g); bool u, d;
      strum_guard_step(&g, true, false, false, false, 5000, 15, &u, &d); CHECK(u && !d); }

    scenarios(1000000u, "normal");
    scenarios(0xFFFFFFFFu - MS(200), "wrap mid-sequence");   // time_us_32 wraps between the press and the release
    scenarios(0xFFFFFFFFu - MS(302), "wrap at the release");
    scenarios(0xFFFFFFFFu - MS(310), "wrap during the guard");

    // an old stamp must not come back as a guard window after the 32 bit clock wraps (~71 min)
    { strum_guard_t g; memset(&g, 0, sizeof g); bool u, d;
      strum_guard_step(&g, false, true, false, false, 100, 15, &u, &d);
      strum_guard_step(&g, false, false, false, true, 200, 15, &u, &d);
      for (uint32_t t = 1000000u; t < 1000000u + 200000u; t += 100) strum_guard_step(&g, false, false, false, false, t, 15, &u, &d);
      strum_guard_step(&g, true, false, false, false, 100u + 0u, 15, &u, &d);   // t wrapped back near the old stamp
      CHECK(u); }

    // ext config: byte 356 layout, validation, defaults
    ext_config_t e; ext_defaults(&e);
    CHECK(e.strum_guard == 0 && ext_validate(&e, NULL));
    uint8_t ok[] = { 0, 1, 15, 40, 255 };
    for (unsigned i = 0; i < sizeof ok; i++) { ext_defaults(&e); e.strum_guard = ok[i]; ext_seal(&e); CHECK(ext_validate(&e, NULL)); }
    uint8_t bad[] = { 41, 100, 200, 254 };
    for (unsigned i = 0; i < sizeof bad; i++) { ext_defaults(&e); e.strum_guard = bad[i]; ext_seal(&e); CHECK(!ext_validate(&e, NULL)); }
    CHECK(((uint8_t *)&e)[356] == e.strum_guard);

    if (fails) { printf("%d FAILED\n", fails); return 1; }
    printf("strum_guard_test: all passed\n");
    return 0;
}
