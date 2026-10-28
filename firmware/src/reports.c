#include "reports.h"
#include <string.h>
#include "config.h"

// Guitar modes: A, B, Y, X, LB are the green, red, yellow, blue, orange frets (what the default map puts there) and
// land in the native slot of that fret; D-pad up / down are the strum; Back is star power; RX is the whammy axis.
// RB doubles as the tilt button where the native report has one (PS3 Rock Band R1, Switch R, original Xbox white).

static inline bool B(const gpad_t *g, int n) { return GP_BTN(g, n) != 0; }

// whammy 0..32767 out of RX (rest at -32767): what the default map's whammy source produces. Nothing on RX = at rest.
static inline int32_t gp_whammy(const gpad_t *g) {
    if (!(g->driven & DRV_RX)) return 0;
    int32_t w = ((int32_t)g->rx + 32767) >> 1;
    return w < 0 ? 0 : w;
}

// -32767..32767 -> 0..255 around 0x80
static inline uint8_t ax8(int32_t v) {
    int32_t r = (v + 32768) >> 8;
    return (uint8_t)(r < 0 ? 0 : r > 255 ? 255 : r);
}
static inline uint8_t ax8i(int32_t v) { return ax8(-v); }   // Y axes: HID and PlayStation want down = larger

static inline uint8_t hat_of(const gpad_t *g) {
    static const uint8_t tab[3][3] = {   // [vertical + 1][horizontal + 1]: up, none, down x left, none, right
        {7, 0, 1}, {6, 8, 2}, {5, 4, 3}};
    int v = (B(g, OUT_DUP) && !B(g, OUT_DDOWN)) ? 0 : (B(g, OUT_DDOWN) && !B(g, OUT_DUP)) ? 2 : 1;
    int h = (B(g, OUT_DRIGHT) && !B(g, OUT_DLEFT)) ? 2 : (B(g, OUT_DLEFT) && !B(g, OUT_DRIGHT)) ? 0 : 1;
    return tab[v][h];
}

static inline uint8_t frets_bits(const gpad_t *g) {   // green, red, yellow, blue, orange
    return (uint8_t)((B(g, OUT_A) ? 0x01 : 0) | (B(g, OUT_B) ? 0x02 : 0) | (B(g, OUT_Y) ? 0x04 : 0) |
                     (B(g, OUT_X) ? 0x08 : 0) | (B(g, OUT_LB) ? 0x10 : 0));
}

static inline void put16(uint8_t *p, int16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)((uint16_t)v >> 8); }

// ---- Xbox 360 guitar, 20 byte report: whammy on right stick X, tilt on right stick Y (nothing mapped to RY)
uint16_t rpt_xinput(const gpad_t *g, uint8_t *out) {
    static const uint16_t m[18] = {0, 0x1000, 0x2000, 0x4000, 0x8000, 0x0100, 0x0200, 0, 0, 0x0020, 0x0010, 0x0400,
                                   0x0040, 0x0080, 0x0001, 0x0002, 0x0004, 0x0008};
    uint16_t b = 0;
    for (int n = 1; n <= 17; n++) if (m[n] && B(g, n)) b |= m[n];
    // Fortnite Festival on PC reads overdrive from D-pad left
    if (B(g, OUT_BACK) && (g_cfg.flags & CFG_FLAG_STAR_DPAD_LEFT)) b |= 0x0004;
    memset(out, 0, RPT_XINPUT_LEN);
    out[1] = RPT_XINPUT_LEN;
    out[2] = (uint8_t)b;
    out[3] = (uint8_t)(b >> 8);
    out[4] = (uint8_t)(g->lt >> 7);
    out[5] = (uint8_t)(g->rt >> 7);
    put16(&out[6], g->lx);
    put16(&out[8], g->ly);
    put16(&out[10], g->rx);
    // games read star power from the tilt axis too
    put16(&out[12], (g->driven & DRV_RY) ? g->ry : (B(g, OUT_BACK) ? 32767 : -32768));
    return RPT_XINPUT_LEN;
}

// ---- PS3 Guitar Hero guitar, 27 byte report (layout matches the descriptor)
uint16_t rpt_ps3(const gpad_t *g, uint8_t *out) {
    memset(out, 0, RPT_PS3_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (B(g, OUT_Y))  b0 |= 0x01;   // yellow
    if (B(g, OUT_A))  b0 |= 0x02;   // green
    if (B(g, OUT_B))  b0 |= 0x04;   // red
    if (B(g, OUT_X))  b0 |= 0x08;   // blue
    if (B(g, OUT_LB)) b0 |= 0x10;   // orange
    if (B(g, OUT_RB)) b0 |= 0x20;
    if (B(g, OUT_LT_BTN)) b0 |= 0x40;
    if (B(g, OUT_RT_BTN)) b0 |= 0x80;
    if (B(g, OUT_BACK))  b1 |= 0x01;   // select
    if (B(g, OUT_START)) b1 |= 0x02;
    if (B(g, OUT_L3))    b1 |= 0x04;
    if (B(g, OUT_R3))    b1 |= 0x08;
    if (B(g, OUT_GUIDE)) b1 |= 0x10;   // PS
    out[0] = b0;
    out[1] = b1;
    out[2] = hat_of(g);
    out[3] = ax8(g->lx);
    out[4] = ax8i(g->ly);
    // Real GH guitars rest the whammy at 0x80 and go up to 0xFF (Santroller 24e78967: 0x80 + (v >> 9) of 16 bits)
    out[5] = (uint8_t)(0x80 + (gp_whammy(g) >> 8));
    out[6] = (g->driven & DRV_RY) ? ax8i(g->ry) : 0x80;   // touch slider idle
    // Fret pressures are 0 or 0xFF like a real guitar (Santroller 6f3d291f): yellow, (left, unused), green / strum
    // up, orange / strum down, blue, red. A fret sharing a byte with its strum direction reads 0 when both are held.
    bool up = B(g, OUT_DUP) && !B(g, OUT_DDOWN), down = B(g, OUT_DDOWN) && !B(g, OUT_DUP);
    out[7]  = B(g, OUT_Y) ? 0xFF : 0x00;
    out[9]  = (B(g, OUT_A)  != up)   ? 0xFF : 0x00;
    out[10] = (B(g, OUT_LB) != down) ? 0xFF : 0x00;
    out[11] = B(g, OUT_X) ? 0xFF : 0x00;
    out[12] = B(g, OUT_B) ? 0xFF : 0x00;
    for (int i = 0; i < 4; i++) {   // accelerometer words centred (tilt, z, y, unused)
        out[19 + 2 * i] = 0x00;
        out[20 + 2 * i] = 0x02;   // 0x0200
    }
    return RPT_PS3_LEN;
}

// ---- PS3 Rock Band guitar, 27 byte report (Santroller's PS3RockBandGuitar_Data_t layout)
// byte 0: blue, green, red, yellow, orange, tilt(R1), L2, R2   byte 1: select, start, L3, R3, PS
uint16_t rpt_ps3_rb(const gpad_t *g, uint8_t *out) {
    memset(out, 0, RPT_PS3_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (B(g, OUT_X))  b0 |= 0x01;   // blue
    if (B(g, OUT_A))  b0 |= 0x02;   // green
    if (B(g, OUT_B))  b0 |= 0x04;   // red
    if (B(g, OUT_Y))  b0 |= 0x08;   // yellow
    if (B(g, OUT_LB)) b0 |= 0x10;   // orange
    if (g->tilt || B(g, OUT_RB)) b0 |= 0x20;   // Rock Band reads tilt as R1
    if (B(g, OUT_LT_BTN)) b0 |= 0x40;
    if (B(g, OUT_RT_BTN)) b0 |= 0x80;
    if (B(g, OUT_BACK))  b1 |= 0x01;
    if (B(g, OUT_START)) b1 |= 0x02;
    if (B(g, OUT_L3))    b1 |= 0x04;
    if (B(g, OUT_R3))    b1 |= 0x08;
    if (B(g, OUT_GUIDE)) b1 |= 0x10;
    out[0] = b0;
    out[1] = b1;
    out[2] = hat_of(g);
    out[3] = ax8(g->lx);
    out[4] = ax8i(g->ly);
    out[5] = (uint8_t)(gp_whammy(g) >> 7);
    out[6] = (g->driven & DRV_RY) ? ax8i(g->ry) : 0x00;   // pickup selector position
    for (int i = 0; i < 4; i++) {
        out[19 + 2 * i] = 0x00;
        out[20 + 2 * i] = 0x02;   // 0x0200
    }
    return RPT_PS3_LEN;
}

// ---- Nintendo Switch (HORIPAD layout), 8 byte report
uint16_t rpt_switch(const gpad_t *g, uint8_t *out) {
    uint16_t b = 0;
    if (B(g, OUT_X))  b |= 1u << 0;    // Y   (yellow is X and blue is Y, as in Santroller beb9b937)
    if (B(g, OUT_B))  b |= 1u << 1;    // B
    if (B(g, OUT_A))  b |= 1u << 2;    // A
    if (B(g, OUT_Y))  b |= 1u << 3;    // X
    if (B(g, OUT_LB)) b |= 1u << 4;    // L
    if (g->tilt || B(g, OUT_RB)) b |= 1u << 5;   // R
    if (B(g, OUT_LT_BTN)) b |= 1u << 6;   // ZL
    if (B(g, OUT_RT_BTN)) b |= 1u << 7;   // ZR
    if (B(g, OUT_BACK))   b |= 1u << 8;   // minus
    if (B(g, OUT_START))  b |= 1u << 9;   // plus
    if (B(g, OUT_L3))     b |= 1u << 10;
    if (B(g, OUT_R3))     b |= 1u << 11;
    if (B(g, OUT_GUIDE))  b |= 1u << 12;  // home
    out[0] = (uint8_t)b;
    out[1] = (uint8_t)(b >> 8);
    out[2] = hat_of(g);
    out[3] = ax8(g->lx);
    out[4] = ax8i(g->ly);
    // right stick X = whammy: rests at the stick centre and pushes down toward the minimum (Santroller beb9b937)
    uint8_t wh = (uint8_t)(0x80 - (gp_whammy(g) >> 8));   // 0..32767 -> 0x80..0x01
    out[5] = wh ? wh : 0x01;
    out[6] = (g->driven & DRV_RY) ? ax8i(g->ry) : 0x80;
    out[7] = 0x00;
    return RPT_SWITCH_LEN;
}

// ---- original Xbox ("Duke"), 20 byte report
uint16_t rpt_ogxbox(const gpad_t *g, uint8_t *out) {
    memset(out, 0, RPT_OGXBOX_LEN);
    out[1] = RPT_OGXBOX_LEN;
    uint8_t d = 0;
    if (B(g, OUT_DUP))    d |= 0x01;
    if (B(g, OUT_DDOWN))  d |= 0x02;
    if (B(g, OUT_DLEFT))  d |= 0x04;
    if (B(g, OUT_DRIGHT)) d |= 0x08;
    if (B(g, OUT_START))  d |= 0x10;
    if (B(g, OUT_BACK))   d |= 0x20;
    if (B(g, OUT_L3))     d |= 0x40;
    if (B(g, OUT_R3))     d |= 0x80;
    out[2] = d;
    out[4] = B(g, OUT_A) ? 0xFF : 0;    // A
    out[5] = B(g, OUT_B) ? 0xFF : 0;    // B
    out[6] = B(g, OUT_X) ? 0xFF : 0;    // X
    out[7] = B(g, OUT_Y) ? 0xFF : 0;    // Y
    out[8] = B(g, OUT_LB) ? 0xFF : 0;   // black
    out[9] = (g->tilt || B(g, OUT_RB)) ? 0xFF : 0;   // white
    out[10] = (uint8_t)(g->lt >> 7);
    out[11] = (uint8_t)(g->rt >> 7);
    put16(&out[12], g->lx);
    put16(&out[14], g->ly);
    put16(&out[16], g->rx);   // right stick X = whammy
    put16(&out[18], g->ry);
    return RPT_OGXBOX_LEN;
}

// ---- generic HID gamepad, 7 byte report
uint16_t rpt_hid(const gpad_t *g, uint8_t *out) {
    uint16_t b = 0;
    if (B(g, OUT_A))     b |= 1u << 0;
    if (B(g, OUT_B))     b |= 1u << 1;
    if (B(g, OUT_Y))     b |= 1u << 2;
    if (B(g, OUT_X))     b |= 1u << 3;
    if (B(g, OUT_LB))    b |= 1u << 4;
    if (B(g, OUT_BACK))  b |= 1u << 5;
    if (B(g, OUT_START)) b |= 1u << 6;
    if (B(g, OUT_DUP))   b |= 1u << 7;
    if (B(g, OUT_DDOWN)) b |= 1u << 8;
    if (B(g, OUT_RB))    b |= 1u << 9;
    if (B(g, OUT_L3))    b |= 1u << 10;
    if (B(g, OUT_R3))    b |= 1u << 11;
    if (B(g, OUT_GUIDE)) b |= 1u << 12;
    if (B(g, OUT_LT_BTN)) b |= 1u << 13;
    if (B(g, OUT_RT_BTN)) b |= 1u << 14;
    out[0] = (uint8_t)b;
    out[1] = (uint8_t)(b >> 8);
    out[2] = hat_of(g);           // neutral is 8 (null state)
    out[3] = ax8(g->lx);
    out[4] = ax8i(g->ly);
    out[5] = (uint8_t)(gp_whammy(g) >> 7);
    // Rz follows the tilt sensor only. Pressing star power moves button 6 alone, so a game binding it
    // (Clone Hero's remap screen) records a plain button with a label, not an unnamed axis.
    out[6] = (g->driven & DRV_RY) ? ax8i(g->ry) : (g->tilt ? 0xFF : 0x00);
    return RPT_HID_LEN;
}

// ---- PS4 Rock Band 4-style guitar, 64 byte DualShock 4 report (report id 1).
// Layout as Santroller's PS4RockBandGuitar_Data_t / GP2040-CE's PS4Report guitar union.
uint16_t rpt_ps4(const gpad_t *g, uint8_t *out) {
    memset(out, 0, RPT_PS4_LEN);
    out[0] = 0x01;
    out[1] = ax8(g->lx);
    out[2] = ax8i(g->ly);
    out[3] = 0x80;                                      // right stick X is the whammy, in byte 44
    out[4] = (g->driven & DRV_RY) ? ax8i(g->ry) : 0x80;
    uint8_t b5 = hat_of(g);
    if (B(g, OUT_X)) b5 |= 0x10;                        // square (blue)
    if (B(g, OUT_A)) b5 |= 0x20;                        // cross (green)
    if (B(g, OUT_B)) b5 |= 0x40;                        // circle (red)
    if (B(g, OUT_Y)) b5 |= 0x80;                        // triangle (yellow)
    uint8_t b6 = 0;
    if (B(g, OUT_LB)) b6 |= 0x01;                       // L1 (orange)
    if (B(g, OUT_RB)) b6 |= 0x02;
    if (B(g, OUT_LT_BTN)) b6 |= 0x04;
    if (B(g, OUT_RT_BTN)) b6 |= 0x08;
    if (B(g, OUT_BACK))  b6 |= 0x10;                    // share = overdrive
    if (B(g, OUT_START)) b6 |= 0x20;                    // options
    if (B(g, OUT_L3)) b6 |= 0x40;
    if (B(g, OUT_R3)) b6 |= 0x80;
    out[5] = b5;
    out[6] = b6;
    out[7] = B(g, OUT_GUIDE) ? 0x01 : 0x00;             // PS (the sender adds the counter and the wake-up tap)
    out[8] = (uint8_t)(g->lt >> 7);
    out[9] = (uint8_t)(g->rt >> 7);
    out[30] = 0x1B;                                     // cable connected, battery full (as a wired DS4)
    out[43] = 0x00;                                     // pickup selector notch
    out[44] = (uint8_t)(gp_whammy(g) >> 7);             // whammy, 0 = rest
    out[45] = g->tilt ? 0xFF : 0x00;                    // tilt
    out[46] = frets_bits(g);
    return RPT_PS4_LEN;
}

// ---- PS5 Rock Band guitar, 64 byte report (Santroller's PS5RockBandGuitar_Data_t). It goes to the P5General,
// which hands back the copy the console accepts.
uint16_t rpt_ps5(const gpad_t *g, uint8_t *out) {
    memset(out, 0, RPT_PS5_LEN);
    out[0] = 0x01;
    out[1] = ax8(g->lx);
    out[2] = ax8i(g->ly);
    out[3] = 0x80;
    out[4] = (g->driven & DRV_RY) ? ax8i(g->ry) : 0x80;
    out[5] = (uint8_t)(g->lt >> 7);
    out[6] = (uint8_t)(g->rt >> 7);
    uint8_t b8 = hat_of(g);
    if (B(g, OUT_X)) b8 |= 0x10;                        // square (blue)
    if (B(g, OUT_A)) b8 |= 0x20;                        // cross (green)
    if (B(g, OUT_B)) b8 |= 0x40;                        // circle (red)
    if (B(g, OUT_Y)) b8 |= 0x80;                        // triangle (yellow)
    uint8_t b9 = 0;
    if (B(g, OUT_LB)) b9 |= 0x01;                       // L1 (orange)
    if (B(g, OUT_RB)) b9 |= 0x02;
    if (B(g, OUT_LT_BTN)) b9 |= 0x04;
    if (B(g, OUT_RT_BTN)) b9 |= 0x08;
    if (B(g, OUT_BACK))  b9 |= 0x10;                    // create = overdrive
    if (B(g, OUT_START)) b9 |= 0x20;                    // options
    if (B(g, OUT_L3)) b9 |= 0x40;
    if (B(g, OUT_R3)) b9 |= 0x80;
    out[8] = b8;
    out[9] = b9;
    out[10] = B(g, OUT_GUIDE) ? 0x01 : 0x00;            // PS
    out[30] = 0x1A;                                     // as a DualSense
    out[40] = 0x00;                                     // pickup selector notch
    out[41] = (uint8_t)(gp_whammy(g) >> 7);             // whammy, 0 = rest
    out[42] = g->tilt ? 0xFF : 0x00;                    // tilt
    out[43] = frets_bits(g);
    return RPT_PS5_LEN;
}

// ---- Xbox One Rock Band 4-style guitar: 32 byte GIP input body (Santroller's XboxOneRockBandGuitar_Data_t)
void rpt_xbone(const gpad_t *g, uint8_t *out) {
    memset(out, 0, RPT_XBONE_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (B(g, OUT_START)) b0 |= 0x04;                    // menu
    if (B(g, OUT_BACK))  b0 |= 0x08;                    // view = overdrive
    if (B(g, OUT_A)) b0 |= 0x10;                        // A (green)
    if (B(g, OUT_B)) b0 |= 0x20;                        // B (red)
    if (B(g, OUT_X)) b0 |= 0x40;                        // X (blue)
    if (B(g, OUT_Y)) b0 |= 0x80;                        // Y (yellow)
    if (B(g, OUT_DUP))    b1 |= 0x01;
    if (B(g, OUT_DDOWN))  b1 |= 0x02;
    if (B(g, OUT_DLEFT))  b1 |= 0x04;
    if (B(g, OUT_DRIGHT)) b1 |= 0x08;
    if (B(g, OUT_LB)) b1 |= 0x10;                       // orange
    if (B(g, OUT_RB)) b1 |= 0x20;
    if (B(g, OUT_L3)) b1 |= 0x40;
    if (B(g, OUT_R3)) b1 |= 0x80;
    out[0] = b0;
    out[1] = b1;
    out[2] = g->tilt ? 0xFF : 0x00;                     // tilt
    out[3] = (uint8_t)(gp_whammy(g) >> 7);              // whammy
    out[4] = 0x00;                                      // pickup selector
    out[5] = frets_bits(g);
}
