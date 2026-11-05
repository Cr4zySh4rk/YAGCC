// Host test for the tilt switch filter (tilt_filter.h, ext bytes 354 / 355). cc -I../../src tilt_filter_test.c ../../src/ext_config.c
#include <stdio.h>
#include <string.h>
#include "tilt_filter.h"
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

// run the filter for `ms` milliseconds polling every 100 us with a raw level; returns the final output, t advances
static uint32_t T;
static bool run(tilt_filter_t *f, bool raw, int ms, uint8_t type, uint8_t st) {
    bool o = f->out;
    for (int i = 0; i < ms * 10; i++) { T += 100; o = tilt_filter_step(f, raw, T, type, st); }
    return o;
}
// ms until the output follows a stable raw level (-1 never within 500 ms)
static int settle(uint8_t type, uint8_t st, bool level) {
    tilt_filter_t f; memset(&f, 0, sizeof f); T = 1000;
    run(&f, !level, 100, type, st);
    for (int i = 0; i < 5000; i++) { T += 100; if (tilt_filter_step(&f, level, T, type, st) == level) return (i + 1) / 10; }
    return -1;
}
// raw square wave with half-period `half_ms` (starting high) for `total_ms`; returns number of output edges
static int edges(uint8_t type, uint8_t st, int half_ms, int total_ms, int duty_high_pct) {
    tilt_filter_t f; memset(&f, 0, sizeof f); T = 1000; bool last = false; int n = 0;
    run(&f, false, 100, type, st);
    int per = half_ms * 2, hi = per * duty_high_pct / 100;
    for (int t = 0; t < total_ms; t++) {
        bool raw = (t % per) < hi;
        bool o = run(&f, raw, 1, type, st);
        if (o != last) { n++; last = o; }
    }
    return n;
}

int main(void) {
    CHECK(!tilt_filter_used(0, 0) && tilt_filter_used(0, 10) && tilt_filter_used(1, 0));
    CHECK(tilt_filter_settle_ms(1, 0) == 40 && tilt_filter_settle_ms(1, 90) == 90 && tilt_filter_settle_ms(0, 25) == 25);
    // settle time per type
    int s;
    s = settle(0, 25, true);  CHECK(s >= 25 && s <= 26);
    s = settle(0, 25, false); CHECK(s >= 25 && s <= 26);
    s = settle(0, 1, true);   CHECK(s >= 1 && s <= 2);
    s = settle(0, 250, true); CHECK(s >= 250 && s <= 251);
    s = settle(1, 0, true);   CHECK(s >= 40 && s <= 48);          // default 40 ms after the 8 ms majority window
    s = settle(1, 0, false);  CHECK(s >= 40 && s <= 48);
    s = settle(1, 100, true); CHECK(s >= 100 && s <= 108);
    // bounce trains: rattling faster than the settle time never changes the state
    CHECK(edges(0, 25, 2, 400, 50) == 0);
    CHECK(edges(0, 25, 10, 400, 50) == 0);
    CHECK(edges(0, 25, 30, 400, 50) > 0);                          // slower than the settle time passes through
    CHECK(edges(1, 0, 1, 600, 50) == 0);                           // 1 ms rattle
    CHECK(edges(1, 0, 5, 600, 50) == 0);
    CHECK(edges(1, 0, 15, 600, 50) == 0);                          // 15 ms bounce, shorter than the 40 ms settle
    CHECK(edges(1, 0, 25, 600, 50) == 0);
    CHECK(edges(1, 0, 60, 1200, 50) > 0);                          // a real slow tilt gets through
    CHECK(edges(1, 0, 3, 600, 70) <= 1);                          // mostly closed with dropouts: at most one edge, no flicker
    // mostly open with short closures (strum rattle) stays released
    {
        tilt_filter_t f; memset(&f, 0, sizeof f); T = 1000; run(&f, false, 50, 1, 0); int n = 0; bool l = false;
        for (int k = 0; k < 40; k++) { bool o = run(&f, true, 3, 1, 0); if (o != l) { n++; l = o; } o = run(&f, false, 17, 1, 0); if (o != l) { n++; l = o; } }
        CHECK(n == 0);
    }
    // a bounce burst then a stable press: exactly one edge, after the burst
    {
        tilt_filter_t f; memset(&f, 0, sizeof f); T = 1000; run(&f, false, 50, 1, 0); int n = 0; bool l = false;
        for (int k = 0; k < 6; k++) { bool o = run(&f, true, 2, 1, 0); if (o != l) { n++; l = o; } o = run(&f, false, 3, 1, 0); if (o != l) { n++; l = o; } }
        bool o = run(&f, true, 80, 1, 0); if (o != l) { n++; l = o; }
        CHECK(n == 1 && l);
        run(&f, false, 80, 1, 0); CHECK(!f.out);
    }
    // normally closed: the caller inverts the raw level (input.c), so a closed contact at rest reads "not tilted" and opening presses
    {
        tilt_filter_t f; memset(&f, 0, sizeof f); T = 1000; bool contact_closed = true; (void)contact_closed;
        CHECK(run(&f, !true, 100, 1, 0) == false);                 // closed at rest -> raw (inverted) low
        CHECK(run(&f, !false, 100, 1, 0) == true);                 // opens -> tilted
        CHECK(run(&f, !true, 100, 1, 0) == false);
    }
    // starts where the pin is
    { tilt_filter_t f; memset(&f, 0, sizeof f); T = 1000; CHECK(tilt_filter_step(&f, true, T, 1, 0) == true); }
    // ext page
    ext_config_t e; ext_defaults(&e);
    CHECK(offsetof(ext_config_t, tilt_sw_type) == 354 && offsetof(ext_config_t, tilt_sw_filter_ms) == 355 && ext_validate(&e, NULL));
    e.tilt_sw_type = 1; e.tilt_sw_filter_ms = 250; ext_seal(&e); CHECK(ext_validate(&e, NULL));
    e.tilt_sw_type = 2; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    e.tilt_sw_type = 0; e.tilt_sw_filter_ms = 251; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    printf(fails ? "tilt_filter: %d FAILED\n" : "tilt_filter: ok\n", fails);
    return fails != 0;
}
