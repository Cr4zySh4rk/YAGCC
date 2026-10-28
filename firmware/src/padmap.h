// Input mapping layer (firmware 0.42): the 22 physical sources -> the running mode's map row -> a generic gamepad
// that the per-mode report packers (reports.c) turn into native reports. No hardware access: the host tests build
// this file as is.
#ifndef YACC_PADMAP_H_
#define YACC_PADMAP_H_

#include <stdint.h>
#include <stdbool.h>
#include "ext_config.h"

// What the sources read right now (filled by main.c from input.c)
typedef struct {
    uint32_t dig;            // bit s = digital source s pressed: frets..plus (0..8, without tilt-driven presses),
                             // tilt switch (10), D-pad (13..16), select (17), home (18), stick click (21)
    int16_t  whammy;         // the bar alone, 0..32767
    int16_t  sens[2];        // analog tilt sensors, calibrated 0..32767 (0 = not fitted)
    int16_t  sens_whammy[2]; // sensor i set to the whammy target on the Tune page (deadzone applied), else 0
    int16_t  stick[2];       // X, Y after calibration / deadzone / swap / invert, -32767..32767
    uint8_t  sens_thr[2];    // percent where a sensor counts as pressed
    int8_t   tilt_fn[3];     // the Tune page path of tilt switch, sensor 1, sensor 2: F_* it presses right now, -1 none
} padsrc_t;

// The generic pad a mode's map produces
typedef struct {
    uint32_t btn;            // bit n-1 = digital output n (OUT_A .. OUT_DRIGHT)
    int16_t  lx, ly, rx, ry; // -32767..32767, centre 0, Y positive = up
    int16_t  lt, rt;         // 0..32767
    uint8_t  driven;         // bit0 LX .. bit5 RT: some source is mapped to that axis (full or half)
    bool     tilt;           // a tilt input on its Tune page path acts as star power: guitars with a tilt field report it
} gpad_t;
#define DRV_LX (1u << 0)
#define DRV_LY (1u << 1)
#define DRV_RX (1u << 2)
#define DRV_RY (1u << 3)
#define DRV_LT (1u << 4)
#define DRV_RT (1u << 5)
#define GP_BTN(g, n) (((g)->btn >> ((n) - 1)) & 1u)

uint8_t padmap_default_out(int src);                                   // output of source `src` at MAP_DEFAULT (0xFF for the tilt sources)
void padmap_build(const padsrc_t *s, const uint8_t *row, gpad_t *g);   // row = EXT_MAP_COLS bytes, NULL = all defaults
void padmap_reset(void);                                               // forget the tilt sensors' press state
// raw ADC reading -> -32767..32767 around `mid` (min < mid < max), then a deadzone of dz percent, rescaled
int16_t padmap_cal_axis(uint16_t raw, uint16_t mn, uint16_t md, uint16_t mx, uint8_t dz);

#endif
