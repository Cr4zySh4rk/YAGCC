// Host test for reliability.h: reset reason decoding, unclean-reset counting, Bluetooth skip, vendor request shape checks.
// cc -DYACC_HOST_TEST -I../../src rel_test.c
#include <stdio.h>
#include "reliability.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

int main(void) {
    // not a watchdog reset: always RR_POWER, whatever the scratch register holds (it is garbage after power on)
    CHECK(rel_decode(false, false, 0) == RR_POWER);
    CHECK(rel_decode(false, true, rel_pack(2, REL_CODE_HARDFAULT)) == RR_POWER);
    // armed watchdog expired
    CHECK(rel_decode(true, true, 0) == RR_WATCHDOG);
    CHECK(rel_decode(true, true, 0x12345678u) == RR_WATCHDOG);                 // no magic: scratch ignored
    // watchdog_reboot() from the firmware (mode switch, Auto, sleep wake, configurator)
    CHECK(rel_decode(true, false, rel_pack(0, REL_CODE_NONE)) == RR_REBOOT);
    // fault records win over everything
    CHECK(rel_decode(true, false, rel_pack(0, REL_CODE_HARDFAULT)) == RR_HARDFAULT);
    CHECK(rel_decode(true, true, rel_pack(1, REL_CODE_HARDFAULT)) == RR_HARDFAULT);
    CHECK(rel_decode(true, true, rel_pack(0, REL_CODE_STACK)) == RR_STACK);
    CHECK(rel_decode(true, true, rel_pack(0, REL_CODE_BTINIT)) == RR_BT_INIT);
    CHECK(rel_decode(true, true, rel_pack(0, 0x7F)) == RR_WATCHDOG);           // unknown code: plain watchdog
    // which reasons count as crashes (no mode shortcuts, counted)
    CHECK(!rel_unclean(RR_POWER) && !rel_unclean(RR_REBOOT));
    CHECK(rel_unclean(RR_WATCHDOG) && rel_unclean(RR_HARDFAULT) && rel_unclean(RR_STACK) && rel_unclean(RR_BT_INIT));
    // counting consecutive crashes
    CHECK(rel_count_next(RR_POWER, rel_pack(5, 0)) == 0);
    CHECK(rel_count_next(RR_REBOOT, rel_pack(5, 0)) == 0);
    CHECK(rel_count_next(RR_WATCHDOG, 0) == 1);                                // scratch had no magic
    CHECK(rel_count_next(RR_WATCHDOG, rel_pack(1, 0)) == 2);
    CHECK(rel_count_next(RR_HARDFAULT, rel_pack(254, REL_CODE_HARDFAULT)) == 255);
    CHECK(rel_count_next(RR_HARDFAULT, rel_pack(255, REL_CODE_HARDFAULT)) == 255);   // saturates, no wrap to 0
    // Bluetooth: a hung radio skips it at once, repeated crashes of any kind skip it too
    CHECK(rel_skip_bt(RR_BT_INIT, 1));
    CHECK(!rel_skip_bt(RR_WATCHDOG, 1) && !rel_skip_bt(RR_WATCHDOG, 2));
    CHECK(rel_skip_bt(RR_HARDFAULT, REL_BT_SKIP_AFTER));
    CHECK(!rel_skip_bt(RR_POWER, 0) && !rel_skip_bt(RR_REBOOT, 0));
    // a crash loop is bounded: count reaches the skip threshold after REL_BT_SKIP_AFTER crashes in a row
    { uint32_t s2 = 0; uint8_t c = 0;
      for (int i = 0; i < REL_BT_SKIP_AFTER; i++) { c = rel_count_next(RR_WATCHDOG, s2); s2 = rel_pack(c, 0); }
      CHECK(rel_skip_bt(RR_WATCHDOG, c)); }

    // vendor requests: every handled request has exactly the shape the handler expects
    const uint8_t gets[] = {VREQ_INFO, VREQ_STATUS, VREQ_GETCFG, VREQ_GETEXT, VREQ_BTLOG, VREQ_WEBUSB, VREQ_MS_OS};
    for (unsigned i = 0; i < sizeof gets; i++) {
        CHECK(vreq_shape_ok(gets[i], true, 64));
        CHECK(!vreq_shape_ok(gets[i], false, 64));       // OUT stage on a GET would overwrite g_cfg / tx_buf
        CHECK(!vreq_shape_ok(gets[i], false, 0));
    }
    CHECK(vreq_shape_ok(VREQ_SETCFG, false, 192) && !vreq_shape_ok(VREQ_SETCFG, true, 192) && !vreq_shape_ok(VREQ_SETCFG, false, 0));
    CHECK(vreq_shape_ok(VREQ_SETEXT, false, 512) && !vreq_shape_ok(VREQ_SETEXT, true, 512) && !vreq_shape_ok(VREQ_SETEXT, false, 0));
    const uint8_t cmds[] = {VREQ_SAVE, VREQ_DEFAULTS, VREQ_REBOOT, VREQ_SETMODE, VREQ_RUMBLE, VREQ_LEDTEST, VREQ_LEDPREVIEW};
    for (unsigned i = 0; i < sizeof cmds; i++) {
        CHECK(vreq_shape_ok(cmds[i], false, 0));
        CHECK(!vreq_shape_ok(cmds[i], false, 8));        // a data stage nobody consumes
        CHECK(!vreq_shape_ok(cmds[i], true, 0));
    }
    CHECK(vreq_shape_ok(VREQ_BTLOGFL, true, 16384) && vreq_shape_ok(VREQ_BTLOGFL, false, 0) && !vreq_shape_ok(VREQ_BTLOGFL, false, 4));
    // unknown requests are stalled, all 256 codes
    for (int r = 0; r < 256; r++) {
        bool known = false;
        for (unsigned i = 0; i < sizeof gets; i++) known |= gets[i] == r;
        for (unsigned i = 0; i < sizeof cmds; i++) known |= cmds[i] == r;
        known |= r == VREQ_SETCFG || r == VREQ_SETEXT || r == VREQ_BTLOGFL;
        if (!known) CHECK(!vreq_shape_ok((uint8_t)r, true, 0) && !vreq_shape_ok((uint8_t)r, false, 64));
    }
    if (fails) { printf("%d failures\n", fails); return 1; }
    printf("reliability tests passed\n");
    return 0;
}
