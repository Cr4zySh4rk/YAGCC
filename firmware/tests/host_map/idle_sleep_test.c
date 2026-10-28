// Host test for the Bluetooth idle sleep decision (idle_sleep.h). cc -I../../src idle_sleep_test.c
#include <stdio.h>
#include "idle_sleep.h"
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

int main(void) {
    // config byte
    CHECK(bt_sleep_valid(0) && bt_sleep_valid(1) && bt_sleep_valid(60) && bt_sleep_valid(255));
    CHECK(!bt_sleep_valid(61) && !bt_sleep_valid(100) && !bt_sleep_valid(254));
    CHECK(bt_sleep_timeout_ms(0) == 120000u);
    CHECK(bt_sleep_timeout_ms(1) == 60000u && bt_sleep_timeout_ms(60) == 3600000u);
    CHECK(bt_sleep_timeout_ms(255) == 0 && bt_sleep_timeout_ms(61) == 0);

    idle_t s = {0};
    CHECK(idle_update(&s, 1000, 0, 0, 0, 0));            // first sample starts the timer
    CHECK(!idle_due(&s, 1000 + 119999, 0));
    CHECK(idle_due(&s, 1000 + 120000, 0));                // default 2 min
    CHECK(!idle_due(&s, 1000 + 120000, 255));             // never
    CHECK(!idle_due(&s, 1000 + 120000, 5) && idle_due(&s, 1000 + 300000, 5));
    CHECK(!idle_due(&s, 1000 + 7200000, 61));             // invalid byte never sleeps

    // a button press restarts it
    CHECK(idle_update(&s, 50000, 1u << 3, 0, 0, 0));
    CHECK(!idle_due(&s, 50000 + 119999, 0) && idle_due(&s, 50000 + 120000, 0));
    // holding it is not activity; releasing it is
    CHECK(!idle_update(&s, 100000, 1u << 3, 0, 0, 0));
    CHECK(idle_update(&s, 100001, 0, 0, 0, 0));
    // every digital bit counts: frets, strum, star, plus and the D-pad / select / home / stick click
    for (int b = 0; b < NUM_FUNCS + NUM_EXT_PINS; b++) { CHECK(idle_update(&s, 200000, 1u << b, 0, 0, 0)); CHECK(idle_update(&s, 200000, 0, 0, 0, 0)); }

    // whammy: noise inside the 6 % dead band is ignored, no matter how long it jitters
    idle_update(&s, 300000, 0, 16000, 0, 0);
    for (int i = 0; i < 100; i++) CHECK(!idle_update(&s, 300000 + i, 0, 16000 + (i % 2 ? 1900 : -1900), 0, 0));
    CHECK(idle_update(&s, 310000, 0, 16000 + IDLE_DEADBAND + 1, 0, 0));      // a real move
    CHECK(!idle_update(&s, 310001, 0, 16000 + IDLE_DEADBAND + 1 + 100, 0, 0));
    CHECK(idle_update(&s, 320000, 0, 0, 0, 0));                              // back to rest counts too
    // a slow drift beyond the dead band eventually counts (the reference only moves when it is exceeded)
    idle_update(&s, 400000, 0, 0, 0, 0);
    bool drift = false;
    for (int w = 0; w <= 5000; w += 500) if (idle_update(&s, 400001, 0, w, 0, 0)) drift = true;
    CHECK(drift);
    // stick: twice the range, same 6 % rule
    idle_update(&s, 500000, 0, 0, 0, 0);
    CHECK(!idle_update(&s, 500001, 0, 0, 2 * IDLE_DEADBAND, -2 * IDLE_DEADBAND));
    CHECK(idle_update(&s, 500002, 0, 0, 2 * IDLE_DEADBAND + 1, 0));
    CHECK(idle_update(&s, 500003, 0, 0, 0, 2 * IDLE_DEADBAND + 5000));

    // not eligible (USB host, Bluetooth off): the timer is held
    idle_update(&s, 600000, 0, 0, 0, 0);
    idle_hold(&s, 600000 + 1000000);
    CHECK(!idle_due(&s, 600000 + 1000000 + 119999, 0) && idle_due(&s, 600000 + 1000000 + 120000, 0));
    // millisecond counter wrap
    idle_update(&s, 0xFFFFFF00u, 0, 0, 0, 0);
    CHECK(idle_due(&s, 0xFFFFFF00u + 120000u, 0));

    // ext page: byte 327 and validation
    ext_config_t e;
    ext_defaults(&e);
    CHECK(e.bt_sleep == 0 && ext_validate(&e, NULL));
    e.bt_sleep = 255; ext_seal(&e); CHECK(ext_validate(&e, NULL));
    e.bt_sleep = 30; ext_seal(&e); CHECK(ext_validate(&e, NULL));
    e.bt_sleep = 61; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    e.bt_sleep = 254; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    CHECK(offsetof(ext_config_t, bt_sleep) == 327);

    printf(fails ? "idle sleep: %d FAILED\n" : "idle sleep tests passed\n", fails);
    return fails != 0;
}
