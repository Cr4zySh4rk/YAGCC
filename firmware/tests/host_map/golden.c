// Host tests for the 0.42 input mapping: golden (default map == 0.41 reports, byte for byte) and non-default maps.
#include <stdio.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>

// ---- what the firmware headers would give
#define XINPUT_REPORT_LEN 20
#define PS3_REPORT_LEN 27
#define HID_REPORT_LEN 7
#define KEYBOARD_REPORT_LEN 8
#define SWITCH_REPORT_LEN 8
#define OGXBOX_REPORT_LEN 20
#define PS4_GUITAR_REPORT_LEN 64
#define PS5_REPORT_LEN 64
#define XBONE_GUITAR_PAYLOAD_LEN 32

// ---- the new code under test, as is
#include "config.h"
#include "input.h"
bool atilt_press(bool was_on, int32_t v, uint8_t threshold_pct) {   // same as input.c
    if (v < 0) return false;
    int32_t on = (32767 * (int32_t)threshold_pct) / 100, off = on - 32767 * 4 / 100;
    return was_on ? v > off : v >= on;
}
yacc_config_t g_cfg;
#include "ext_config.c"
#include "padmap.c"
#include "reports.c"

// ---- the 0.41 builders (frozen)
#define pad_t old_pad_t
#include "old_reports.inc"
#undef pad_t

static long fails, checks;
#define CHECK(c, ...) do { checks++; if (!(c)) { if (fails++ < 40) { printf("FAIL line %d: %s ", __LINE__, #c); printf(__VA_ARGS__); printf("\n"); } } } while (0)

enum { M_COUNT = 12 };
static uint16_t old_build(int mode, const old_pad_t *s, uint8_t *o, int *isxb) {
    *isxb = 0;
    switch (mode) {
        case MODE_PS3_GH: return build_ps3(s, o);
        case MODE_PS3_RB: case MODE_WII_RB: return build_ps3_rb(s, o);
        case MODE_SWITCH: return build_switch(s, o);
        case MODE_OGXBOX: return build_ogxbox(s, o);
        case MODE_HID: case MODE_AUTO: return build_hid(s, o);
        case MODE_PS4: return build_ps4(s, o);
        case MODE_PS5: return build_ps5(s, o);
        case MODE_XBONE: build_xbone(s, o); *isxb = 1; return XBONE_GUITAR_PAYLOAD_LEN;
        case MODE_KEYBOARD: return 0;
        default: return build_xinput(s, o);
    }
}
static uint16_t new_build(int mode, const gpad_t *g, uint8_t *o) {
    switch (mode) {
        case MODE_PS3_GH: return rpt_ps3(g, o);
        case MODE_PS3_RB: case MODE_WII_RB: return rpt_ps3_rb(g, o);
        case MODE_SWITCH: return rpt_switch(g, o);
        case MODE_OGXBOX: return rpt_ogxbox(g, o);
        case MODE_HID: case MODE_AUTO: return rpt_hid(g, o);
        case MODE_PS4: return rpt_ps4(g, o);
        case MODE_PS5: return rpt_ps5(g, o);
        case MODE_XBONE: rpt_xbone(g, o); return RPT_XBONE_LEN;
        case MODE_KEYBOARD: return 0;
        default: return rpt_xinput(g, o);
    }
}
static const uint8_t *row_of(int mode) { return (mode != MODE_KEYBOARD && mode != MODE_AUTO) ? g_ext.map[mode] : NULL; }

// ---------------------------------------------------------------- golden
static void golden(void) {
    ext_defaults(&g_ext);
    static const int16_t wh[] = {0, 1, 127, 128, 16383, 32767};
    static const int16_t sw[] = {0, 5000, 32767};         // a tilt sensor on the whammy target
    long combos = 0, diffs = 0, hid_z_changed = 0;
    for (int flag = 0; flag < 2; flag++) {
        g_cfg.flags = flag ? CFG_FLAG_STAR_DPAD_LEFT : 0;
        for (int mode = 0; mode < M_COUNT; mode++) {
            if (mode == MODE_KEYBOARD) continue;           // keyboard keeps its own mapping from the physical pad
            for (int bits = 0; bits < 512; bits++)
                for (int kind = 0; kind < 11; kind++)      // tilt switch: off, star power, or acting as fret / strum / star-less function 0..8
                    for (unsigned wi = 0; wi < 6; wi++)
                        for (unsigned si = 0; si < 3; si++) {
                            old_pad_t o = {0};
                            o.green = bits & 1; o.red = bits >> 1 & 1; o.yellow = bits >> 2 & 1; o.blue = bits >> 3 & 1;
                            o.orange = bits >> 4 & 1; o.strum_up = bits >> 5 & 1; o.strum_down = bits >> 6 & 1;
                            o.star = bits >> 7 & 1; o.plus = bits >> 8 & 1;
                            padsrc_t s; memset(&s, 0, sizeof s);
                            s.dig = (uint32_t)bits;
                            s.tilt_fn[0] = s.tilt_fn[1] = s.tilt_fn[2] = -1;
                            s.whammy = wh[wi];
                            s.sens_whammy[0] = sw[si];
                            if (kind == 1) { s.tilt_fn[0] = F_STAR; o.tilt = true; o.star = true; }
                            else if (kind >= 2) {
                                int f = kind - 2;           // F_GREEN..F_PLUS except star (kind 9 = F_STAR is the same as kind 1 via sensor)
                                if (f == F_STAR) { s.tilt_fn[1] = F_STAR; o.tilt = true; o.star = true; }
                                else {
                                    s.tilt_fn[0] = (int8_t)f;
                                    bool *p[] = {&o.green, &o.red, &o.yellow, &o.blue, &o.orange, &o.strum_up, &o.strum_down, &o.star, &o.plus};
                                    *p[f] = true;
                                }
                            }
                            o.whammy = wh[wi] > sw[si] ? wh[wi] : sw[si];
                            gpad_t g; padmap_build(&s, row_of(mode), &g);
                            uint8_t a[64], b[64]; memset(a, 0xAA, 64); memset(b, 0xAA, 64);
                            int xb; uint16_t la = old_build(mode, &o, a, &xb), lb = new_build(mode, &g, b);
                            combos++;
                            if (mode == MODE_HID || mode == MODE_AUTO) {
                                // INTENTIONAL 0.43 CHANGE (only this byte): HID Z (byte 5) is a plain axis, so the whammy rests at
                                // the centre. Expected = 0x80 + (whammy >> 8): rest 0x80, half 0xBF, full 0xFF (0.42 sent whammy >> 7).
                                int w = wh[wi] > sw[si] ? wh[wi] : sw[si];
                                uint8_t exp = (uint8_t)(0x80 + (w >> 8));
                                CHECK(b[5] == exp, "hid Z whammy %d: got %02x expected %02x", w, b[5], exp);
                                hid_z_changed += a[5] != b[5];
                                a[5] = exp;
                            }
                            if (la != lb || memcmp(a, b, la)) {
                                diffs++;
                                if (diffs < 6) { printf("DIFF mode %d bits %x kind %d wh %d sw %d:\n old", mode, bits, kind, wh[wi], sw[si]); for (int i = 0; i < la; i++) printf(" %02x", a[i]); printf("\n new"); for (int i = 0; i < lb; i++) printf(" %02x", b[i]); printf("\n"); }
                            }
                        }
        }
    }
    g_cfg.flags = 0;
    printf("golden: HID/Auto byte 5 (Z, whammy) deliberately differs from 0.42 in %ld of those comparisons; all other bytes identical\n", hid_z_changed);
    printf("golden: %ld report comparisons (11 modes x 512 digital x 11 tilt kinds x 6 whammy x 3 sensor x 2 flag settings), %ld differences (HID Z byte compared against the documented 0.43 value)\n", combos, diffs);
    checks += combos; fails += diffs;
}

// ---------------------------------------------------------------- helpers for the non-default tests
static padsrc_t quiet(void) { padsrc_t s; memset(&s, 0, sizeof s); s.tilt_fn[0] = s.tilt_fn[1] = s.tilt_fn[2] = -1; s.sens_thr[0] = s.sens_thr[1] = 50; return s; }
static gpad_t pack(const padsrc_t *s, const uint8_t *row) { gpad_t g; padmap_build(s, row, &g); return g; }
static void defrow(uint8_t *row) { memset(row, MAP_DEFAULT, EXT_MAP_COLS); }
static int diffbytes(const uint8_t *a, const uint8_t *b, int n, int *first) { int c = 0; *first = -1; for (int i = 0; i < n; i++) if (a[i] != b[i]) { c++; if (*first < 0) *first = i; } return c; }

static void mapped(void) {
    uint8_t row[EXT_MAP_COLS];
    padmap_reset();
    // ---- green -> D-pad left
    { defrow(row); row[SRC_GREEN] = OUT_DLEFT;
      padsrc_t s = quiet(); s.dig = 1u << SRC_GREEN; gpad_t g = pack(&s, row); uint8_t o[64];
      rpt_xinput(&g, o); CHECK((o[2] & 0x04) && !(o[3] & 0x10), "xinput dpad left, no A");
      rpt_hid(&g, o);    CHECK(o[2] == 6 && !(o[0] & 1), "hid hat left");
      rpt_ps3(&g, o);    CHECK(o[2] == 6 && !(o[0] & 2) && o[9] == 0, "ps3 gh hat left, no green + pressure");
      rpt_ps4(&g, o);    CHECK((o[5] & 15) == 6 && !(o[5] & 0x20) && !(o[46] & 1), "ps4 hat left, no cross, no solo flag");
      rpt_switch(&g, o); CHECK(o[2] == 6 && !(o[0] & 4), "switch hat left, no A");
      rpt_ps5(&g, o);    CHECK((o[8] & 15) == 6, "ps5 hat left");
      rpt_xbone(&g, o);  CHECK((o[1] & 4) && !(o[0] & 0x10), "xbone dpad left");
      rpt_ogxbox(&g, o); CHECK((o[2] & 4) && !o[4], "og dpad left"); }
    // ---- whammy -> LT analog
    { defrow(row); row[SRC_WHAMMY] = OUT_LT;
      padsrc_t s = quiet(); s.whammy = 32767; gpad_t g = pack(&s, row); uint8_t o[64];
      CHECK(g.lt == 32767 && !(g.driven & DRV_RX), "lt full, rx undriven");
      rpt_xinput(&g, o); CHECK(o[4] == 255 && o[10] == 0 && o[11] == 0, "xinput LT byte, RX centred");
      rpt_hid(&g, o);    CHECK((o[1] & 0x20) && o[5] == 0x80, "hid LT button, Z at rest (centre)");
      rpt_ps3(&g, o);    CHECK((o[0] & 0x40) && o[5] == 0x80, "ps3 gh L2 bit, whammy at rest");
      rpt_ps4(&g, o);    CHECK(o[8] == 255 && (o[6] & 4) && o[44] == 0, "ps4 L2 analog + bit");
      rpt_switch(&g, o); CHECK((o[0] & 0x40) && o[5] == 0x80, "switch ZL");
      s.whammy = 8000; g = pack(&s, row); rpt_xinput(&g, o); CHECK(o[4] == (8000 >> 7) && !(o[2] & 0), "partial LT");
      rpt_hid(&g, o); CHECK(!(o[1] & 0x20), "below half: no LT button"); }
    // ---- stick -> LX / LY (defaults)
    { defrow(row);
      padsrc_t s = quiet(); s.stick[0] = 32767; s.stick[1] = -32767; gpad_t g = pack(&s, row); uint8_t o[64];
      CHECK(g.lx == 32767 && g.ly == -32767, "stick on LX/LY");
      rpt_xinput(&g, o); CHECK((int16_t)(o[6] | o[7] << 8) == 32767 && (int16_t)(o[8] | o[9] << 8) == -32767, "xinput LX LY");
      rpt_hid(&g, o);    CHECK(o[3] == 255 && o[4] == 255, "hid X right, Y down (y inverted)");
      rpt_ps3(&g, o);    CHECK(o[3] == 255 && o[4] == 255, "ps3 gh stick");
      rpt_ps4(&g, o);    CHECK(o[1] == 255 && o[2] == 255, "ps4 stick");
      rpt_switch(&g, o); CHECK(o[3] == 255 && o[4] == 255, "switch stick");
      s.stick[0] = s.stick[1] = 0; g = pack(&s, row); rpt_hid(&g, o); CHECK(o[3] == 0x80 && o[4] == 0x80, "centred"); }
    // ---- tilt switch -> RB
    { defrow(row); row[SRC_TILT_SW] = OUT_RB;
      padsrc_t s = quiet(); s.dig = 1u << SRC_TILT_SW; s.tilt_fn[0] = F_STAR; gpad_t g = pack(&s, row); uint8_t o[64];
      CHECK(!g.tilt && !GP_BTN(&g, OUT_BACK) && GP_BTN(&g, OUT_RB), "explicit entry replaces the Tune page path (no star)");
      rpt_xinput(&g, o); CHECK((o[3] & 0x02) && !(o[2] & 0x20), "xinput RB, not back");
      rpt_switch(&g, o); CHECK(o[0] & 0x20, "switch R");
      rpt_ps3(&g, o);    CHECK(o[0] & 0x20, "ps3 gh R1");
      rpt_ps3_rb(&g, o); CHECK(o[0] & 0x20, "ps3 rb R1 (tilt)");
      rpt_ps4(&g, o);    CHECK(o[6] & 2, "ps4 R1");
      rpt_hid(&g, o);    CHECK(o[1] & 2, "hid RB button");
      // default entry: still star power + tilt
      defrow(row); g = pack(&s, row); CHECK(g.tilt && GP_BTN(&g, OUT_BACK), "default entry = star power"); }
    // ---- tilt sensor -> LX+ half axis
    { defrow(row); row[SRC_TILT_S1] = OUT_LXP;
      padsrc_t s = quiet(); s.sens[0] = 16384; gpad_t g = pack(&s, row); uint8_t o[64];
      CHECK(g.lx == 16384, "half axis |value| toward +");
      rpt_xinput(&g, o); CHECK((int16_t)(o[6] | o[7] << 8) == 16384, "xinput LX");
      rpt_hid(&g, o); CHECK(o[3] == 0xC0, "hid X 0xC0 got %02x", o[3]);
      s.sens[0] = 0; g = pack(&s, row); CHECK(g.lx == 0, "at rest 0");
      // a sensor on the whammy target adds to the bar only while its entry is the default
      defrow(row); s.sens_whammy[0] = 30000; s.sens[0] = 0; g = pack(&s, row); CHECK(g.rx == 30000, "tune-page whammy sensor");
      row[SRC_TILT_S1] = OUT_LXP; g = pack(&s, row); CHECK(g.rx == 0, "explicit entry drops its whammy contribution"); }
    // ---- sensor digital press with hysteresis
    { defrow(row); row[SRC_TILT_S2] = OUT_Y; padmap_reset();
      padsrc_t s = quiet(); s.sens_thr[1] = 50; uint8_t seq[] = {0, 1, 1, 1, 0}; int v[] = {10000, 16383, 16384, 15000, 14000};
      int exp[] = {0, 1, 1, 0, 0};       // on at 50 % (16383), off at 46 % (15073)
      for (int i = 0; i < 5; i++) { (void)seq; s.sens[1] = (int16_t)v[i]; gpad_t g = pack(&s, row); CHECK(GP_BTN(&g, OUT_Y) == (unsigned)exp[i], "hysteresis step %d", i); } }
    // ---- combining: OR, farthest from neutral wins, digital to axis = extreme
    { defrow(row); row[SRC_GREEN] = OUT_RX; row[SRC_RED] = OUT_RXM; row[SRC_YELLOW] = OUT_LT; row[SRC_BLUE] = OUT_RT_BTN; row[SRC_ORANGE] = OUT_RT; row[SRC_WHAMMY] = 0;
      padsrc_t s = quiet(); s.dig = (1u << SRC_GREEN) | (1u << SRC_RED) | (1u << SRC_YELLOW) | (1u << SRC_BLUE) | (1u << SRC_ORANGE);
      gpad_t g = pack(&s, row);
      CHECK(g.rx == 32767, "RX+ (green) vs RX- (red): first of equal magnitude wins"); CHECK(g.lt == 32767 && GP_BTN(&g, OUT_LT_BTN), "digital -> LT full axis + bit");
      CHECK(g.rt == 32767 && GP_BTN(&g, OUT_RT_BTN), "RT"); }
    { defrow(row); row[SRC_GREEN] = OUT_A; row[SRC_RED] = OUT_A; row[SRC_WHAMMY] = OUT_A;
      padsrc_t s = quiet(); s.dig = 1u << SRC_RED; gpad_t g = pack(&s, row); CHECK(GP_BTN(&g, OUT_A), "OR of two sources");
      s.dig = 0; s.whammy = 20000; g = pack(&s, row); CHECK(GP_BTN(&g, OUT_A), "analog > 0.5 presses a digital output");
      s.whammy = 16000; g = pack(&s, row); CHECK(!GP_BTN(&g, OUT_A), "analog < 0.5 does not"); }
    { defrow(row); row[SRC_STICK_X] = OUT_RX; row[SRC_WHAMMY] = OUT_RX;       // whammy at rest = 0 (0.43), stick centred 0: farthest wins
      padsrc_t s = quiet(); s.stick[0] = 20000; s.whammy = 30000; gpad_t g = pack(&s, row); CHECK(g.rx == 30000, "whammy 30000 wins over stick 20000 (got %d)", g.rx);
      s.whammy = 20000; s.stick[0] = -30000; g = pack(&s, row); CHECK(g.rx == -30000, "stick -30000 beats whammy 20000"); }
    { defrow(row); row[SRC_STICK_X] = OUT_LT;                                   // stick to a trigger: |value|
      padsrc_t s = quiet(); s.stick[0] = -20000; gpad_t g = pack(&s, row); CHECK(g.lt == 20000, "stick -> trigger is |v|"); }
    { defrow(row); row[SRC_SELECT] = 0;       // nothing
      padsrc_t s = quiet(); s.dig = 1u << SRC_SELECT; gpad_t g = pack(&s, row); CHECK(g.btn == 0, "0 = nothing");
      defrow(row); g = pack(&s, row); CHECK(GP_BTN(&g, OUT_BACK), "select defaults to Back"); }
    { defrow(row);                          // D-pad sources and home / click defaults
      padsrc_t s = quiet(); s.dig = (1u << SRC_DPAD_LEFT) | (1u << SRC_HOME) | (1u << SRC_STICK_CLICK); gpad_t g = pack(&s, row);
      CHECK(GP_BTN(&g, OUT_DLEFT) && GP_BTN(&g, OUT_GUIDE) && GP_BTN(&g, OUT_L3), "dpad left / home / click defaults"); }
    // ---- 0.43: a 0..1 source on a full stick axis spans 0..+1 (rest = centre), triggers and half axes unchanged
    { defrow(row); row[SRC_WHAMMY] = OUT_LX; row[SRC_TILT_S1] = OUT_RY; row[SRC_TILT_S2] = OUT_RT;
      padsrc_t s = quiet(); gpad_t g = pack(&s, row); uint8_t o[64];
      CHECK(g.lx == 0 && g.ry == 0 && g.rt == 0, "rest: LX, RY, RT all 0");
      s.whammy = 32767; s.sens[0] = 16384; s.sens[1] = 32767; g = pack(&s, row);
      CHECK(g.lx == 32767 && g.ry == 16384 && g.rt == 32767, "full whammy = full LX, sensor 16384 -> RY 16384 (got %d %d %d)", g.lx, g.ry, g.rt);
      row[SRC_WHAMMY] = OUT_RXM; g = pack(&s, row); CHECK(g.rx == -32767, "half axis unchanged: RX- = -|v|");
      row[SRC_WHAMMY] = OUT_LT; g = pack(&s, row); CHECK(g.lt == 32767, "trigger unchanged");
      row[SRC_WHAMMY] = OUT_RX; row[SRC_GREEN] = OUT_RX; s.dig = 1u << SRC_GREEN; s.whammy = 0; g = pack(&s, row); CHECK(g.rx == 32767, "digital on a full axis = +1");
      s.dig = 0; g = pack(&s, row); CHECK(g.rx == 0, "released = 0");
      // native whammy = positive half of RX in every mode; HID Z is a plain axis
      defrow(row); s = quiet();
      static const int16_t wv[] = {0, 1, 16383, 32767};
      static const uint8_t hidz[] = {0x80, 0x80, 0xBF, 0xFF};
      for (int i = 0; i < 4; i++) {
          s.whammy = wv[i]; g = pack(&s, row);
          rpt_hid(&g, o); CHECK(o[5] == hidz[i], "hid Z %02x for whammy %d", o[5], wv[i]);
          rpt_xinput(&g, o); CHECK((int16_t)(o[10] | o[11] << 8) == 2 * wv[i] - 32767, "xinput RX keeps the guitar whammy range");
          rpt_ps4(&g, o); CHECK(o[44] == (wv[i] >> 7), "ps4 whammy");
      }
      s.whammy = 0; g = pack(&s, row); rpt_hid(&g, o); CHECK(o[5] == 0x80, "HID whammy at rest = centre"); s.whammy = 32767; g = pack(&s, row); rpt_hid(&g, o); CHECK(o[5] == 0xFF, "HID whammy full = max");
      // a negative RX (RX- / stick left) is no native whammy
      row[SRC_GREEN] = OUT_RXM; s.dig = 1u << SRC_GREEN; s.whammy = 0; g = pack(&s, row); rpt_ps4(&g, o); CHECK(o[44] == 0, "RX- gives no whammy"); }
    // ---- tilt acting as a fret through the Tune page: only while the entry is the default
    { defrow(row); padsrc_t s = quiet(); s.tilt_fn[0] = F_GREEN; gpad_t g = pack(&s, row); CHECK(GP_BTN(&g, OUT_A), "tilt as green");
      row[SRC_TILT_SW] = OUT_B; g = pack(&s, row); CHECK(!GP_BTN(&g, OUT_A) && !GP_BTN(&g, OUT_B), "explicit entry: no green, and B only while the switch is closed"); }
}

// ---------------------------------------------------------------- 0.43 response curve
static void curves(void) {
    static const double xs[] = {0, .1, .25, .5, .75, .9, 1};
    static const int cs[] = {-100, -50, 0, 50, 100};
    printf("curve table (x * 32767 -> padmap_curve, rows c = -100 -50 0 50 100), shared with the JS unit test:\n");
    for (int ci = 0; ci < 5; ci++) {
        printf("  c=%4d:", cs[ci]);
        for (int xi = 0; xi < 7; xi++) {
            int32_t x = (int32_t)lround(xs[xi] * 32767); int c = cs[ci];
            int y = padmap_curve(x, (int8_t)c);
            double fx = x / 32767.0, e = abs(c) / 100.0, fy = c >= 0 ? (1 - e) * fx + e * fx * fx * fx : 1 - ((1 - e) * (1 - fx) + e * pow(1 - fx, 3));
            CHECK(fabs(y - fy * 32767.0) <= 1.0, "curve c=%d x=%d: %d vs %.2f", c, x, y, fy * 32767.0);
            printf(" %d", y);
        }
        printf("\n");
    }
    for (int c = -100; c <= 100; c++) {      // monotonic, end points fixed
        int prev = -1; CHECK(padmap_curve(0, (int8_t)c) == 0 && padmap_curve(32767, (int8_t)c) == 32767, "curve end points c=%d", c);
        for (int x = 0; x <= 32767; x += 97) { int y = padmap_curve(x, (int8_t)c); if (y < prev) { CHECK(0, "curve not monotonic c=%d x=%d", c, x); break; } prev = y; }
    }
    // through the pad: whammy -> LY+ and -> LY full axis, curve 100 (expo), only on the analog value, not on the press threshold
    uint8_t row[EXT_MAP_COLS]; ext_defaults(&g_ext); defrow(row);
    row[SRC_WHAMMY] = OUT_LYP; row[SRC_TILT_S1] = OUT_RY; row[SRC_RED] = OUT_A;
    g_ext.curve[0] = 100; g_ext.curve[1] = -100;
    padsrc_t s = quiet(); s.whammy = 16384; s.sens[0] = 16384; gpad_t g = pack(&s, row);
    CHECK(abs(g.ly - padmap_curve(16384, 100)) <= 0 && g.ly < 4100, "whammy curve +100 on LY+ (got %d)", g.ly);
    CHECK(g.ry == padmap_curve(16384, -100) && g.ry > 28000, "sensor curve -100 on RY (got %d)", g.ry);
    row[SRC_WHAMMY] = OUT_B; s.whammy = 16384; g = pack(&s, row);
    CHECK(GP_BTN(&g, OUT_B), "digital threshold ignores the curve (whammy 0.5000 presses)");
    g_ext.curve[0] = g_ext.curve[1] = 0; g = pack(&s, row); CHECK(g.ry == 16384, "curve 0 = linear");
    // validation and layout
    ext_config_t e; ext_defaults(&e); yacc_config_t mc; memset(&mc, 0xFF, sizeof mc); mc.accel_sda = mc.accel_scl = mc.wii_sda = mc.wii_scl = PIN_NONE;
    for (int i = 0; i < NUM_ATILT; i++) mc.atilt[i].ch = PIN_NONE;
    CHECK(offsetof(ext_config_t, curve) == 320, "curve at offset 320");
    ext_config_t t = e; t.curve[2] = 100; ext_seal(&t); CHECK(ext_validate(&t, &mc), "curve 100 ok");
    t = e; t.curve[1] = -100; ext_seal(&t); CHECK(ext_validate(&t, &mc), "curve -100 ok");
    t = e; t.curve[0] = 101; ext_seal(&t); CHECK(!ext_validate(&t, &mc), "curve 101 rejected");
    t = e; t.curve[1] = -101; ext_seal(&t); CHECK(!ext_validate(&t, &mc), "curve -101 rejected");
    ext_defaults(&g_ext);
}

// ---------------------------------------------------------------- stick calibration, ext page
static void stick_and_ext(void) {
    CHECK(padmap_cal_axis(2048, 0, 2048, 4095, 0) == 0, "mid");
    CHECK(padmap_cal_axis(4095, 0, 2048, 4095, 0) == 32767 && padmap_cal_axis(0, 0, 2048, 4095, 0) == -32767, "ends");
    CHECK(padmap_cal_axis(3000, 1000, 2000, 3000, 0) == 32767 && padmap_cal_axis(1500, 1000, 2000, 3000, 0) == -16383, "off-centre mid");
    CHECK(padmap_cal_axis(2100, 0, 2048, 4095, 10) == 0, "inside the deadzone");
    CHECK(padmap_cal_axis(4095, 0, 2048, 4095, 10) == 32767, "deadzone rescales to full");
    int a = padmap_cal_axis(2048 + 300, 0, 2048, 4095, 10), b = padmap_cal_axis(2048 + 200, 0, 2048, 4095, 10);
    CHECK(a > 0 && b == 0, "deadzone edge (%d %d)", a, b);
    CHECK(padmap_cal_axis(5000, 0, 2048, 4095, 0) == 32767 && padmap_cal_axis(100, 500, 2048, 4095, 0) == -32767, "clamped");

    ext_config_t e; ext_defaults(&e);
    yacc_config_t c; memset(&c, 0xFF, sizeof c); c.accel_sda = c.accel_scl = c.wii_sda = c.wii_scl = PIN_NONE;
    for (int i = 0; i < NUM_ATILT; i++) c.atilt[i].ch = PIN_NONE;
    CHECK(ext_validate(&e, &c), "defaults valid"); CHECK(ext_validate(&e, NULL), "defaults valid, no main");
    CHECK(sizeof e == 512 && offsetof(ext_config_t, crc) == 508 && offsetof(ext_config_t, map) == 32 && offsetof(ext_config_t, x_min) == 20 &&
          offsetof(ext_config_t, stick_x_ch) == 16 && offsetof(ext_config_t, pin_ext) == 8, "layout");
    ext_config_t t;
#define BAD(stmt, what) do { t = e; stmt; ext_seal(&t); CHECK(!ext_validate(&t, &c), what); } while (0)
#define GOOD(stmt, what) do { t = e; stmt; ext_seal(&t); CHECK(ext_validate(&t, &c), what); } while (0)
    t = e; t.crc ^= 1; CHECK(!ext_validate(&t, &c), "bad crc");
    t = e; t.magic = 0; CHECK(!ext_validate(&t, &c), "bad magic");
    t = e; t.version = 2; t.crc = yacc_crc32((uint8_t *)&t, 508); CHECK(!ext_validate(&t, &c), "version");
    GOOD(t.pin_ext[0] = 3; t.pin_ext[6] = 22, "pins ok");
    BAD(t.pin_ext[0] = 23, "pin too high"); BAD(t.pin_ext[0] = 4; t.pin_ext[1] = 4, "duplicate pins");
    BAD(c.pins[0] = 5; t.pin_ext[2] = 5, "clash with fret pin");
    c.pins[0] = PIN_NONE; c.host_dp_pin = 10; BAD(t.pin_ext[2] = 11, "clash with host D-"); GOOD(t.pin_ext[2] = 12, "beyond host D-"); c.host_dp_pin = PIN_NONE;
    c.rumble_pin = 7; BAD(t.pin_ext[3] = 7, "clash with rumble"); c.rumble_pin = PIN_NONE;
    GOOD(t.stick_x_ch = 0; t.stick_y_ch = 1, "channels ok"); BAD(t.stick_x_ch = 3, "channel 3");
    BAD(t.stick_x_ch = 1; t.stick_y_ch = 1, "same channel");
    c.whammy_ch = 0; BAD(t.stick_x_ch = 0, "whammy channel"); GOOD(t.stick_x_ch = 1, "other channel"); c.whammy_ch = PIN_NONE;
    c.atilt[1].ch = 2; BAD(t.stick_y_ch = 2, "tilt sensor channel"); c.atilt[1].ch = PIN_NONE;
    GOOD(t.stick_deadzone = 50, "dz 50"); BAD(t.stick_deadzone = 51, "dz 51");
    BAD(t.x_min = 2048, "min == mid"); BAD(t.y_max = 2048, "max == mid"); BAD(t.x_max = 4096, "max > 4095"); GOOD(t.x_min = 10; t.x_mid = 20; t.x_max = 30, "narrow cal");
    GOOD(t.map[11][21] = 31, "map 31"); BAD(t.map[0][0] = 32, "map 32"); GOOD(t.map[3][5] = 0, "map 0"); BAD(t.map[3][5] = 0xFE, "map 0xFE");
    // the config page layout is the whole sector contract: sealed pages round-trip
    t = e; t.pin_ext[4] = 9; ext_seal(&t); CHECK(ext_validate(&t, &c) && t.crc == yacc_crc32((uint8_t *)&t, 508), "crc");
    uint8_t blank[512]; memset(blank, 0xFF, 512); CHECK(!ext_validate((ext_config_t *)blank, &c), "erased flash is not a valid page");
}

// ---------------------------------------------------------------- which outputs each mode carries (probe: one digital source -> output o)
static uint32_t supported(int mode) {
    uint32_t mask = 0;
    for (int o = 1; o < NUM_OUT; o++) {
        uint8_t row[EXT_MAP_COLS]; memset(row, 0, sizeof row); row[SRC_SELECT] = (uint8_t)o;
        padsrc_t s = quiet(); uint8_t a[64] = {0}, b[64] = {0};
        padmap_reset(); gpad_t g = pack(&s, row); uint16_t la = new_build(mode, &g, a);
        s.dig = 1u << SRC_SELECT; g = pack(&s, row); new_build(mode, &g, b);
        int f; if (diffbytes(a, b, la, &f)) mask |= 1u << o;
    }
    return mask;
}

int main(void) {
    memset(&g_cfg, 0, sizeof g_cfg);
    golden();
    mapped();
    curves();
    stick_and_ext();
    static const char *names[] = {"XInput", "PS3 GH", "HID", "PS3 RB", "Keyboard", "Switch", "Wii RB", "OG Xbox", "PS4", "Xbox One", "Auto", "PS5"};
    printf("supported outputs (bit o = output o carried, o = 1..31):\n");
    for (int m = 0; m < M_COUNT; m++) {
        if (m == MODE_KEYBOARD) { printf("  %2d %-9s none (keyboard keeps its own key map)\n", m, names[m]); continue; }
        uint32_t k = supported(m); printf("  %2d %-9s 0x%08x :", m, names[m], k);
        for (int o = 1; o < NUM_OUT; o++) if (k & (1u << o)) printf(" %d", o);
        printf("\n");
    }
    printf("%ld checks, %ld failures\n", checks, fails);
    return fails ? 1 : 0;
}
