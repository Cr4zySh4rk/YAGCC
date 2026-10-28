// Frozen copy of the 0.41 report builders (git 31d19b1 firmware/src/main.c), the golden reference for golden.c.
// build.sh REFRESH=1 re-extracts it from a git revision of the repo (OLD_REV, default 31d19b1).
typedef struct {
    bool green, red, yellow, blue, orange;
    bool strum_up, strum_down;
    bool star, plus;
    bool tilt;          // tilt switch alone (also folded into `star` for most modes)
    int16_t whammy;     // 0..32767
} pad_t;

// whammy 0..32767 -> full signed range with the rest position at -32768 (what XInput guitars report)
static inline int16_t xi_axis(int16_t v) { return (int16_t)((int32_t)v * 2 - 32767); }

// ---- Xbox 360 guitar, 20 byte report. Guitar Hero (subtype 7) and Rock Band (subtype 6) share
// the layout Santroller uses: whammy on right stick X, tilt on right stick Y.
static uint16_t build_xinput(const pad_t *s, uint8_t *out) {
    uint16_t b = 0;
    if (s->green)  b |= 0x1000;   // A
    if (s->red)    b |= 0x2000;   // B
    if (s->blue)   b |= 0x4000;   // X
    if (s->yellow) b |= 0x8000;   // Y
    if (s->orange) b |= 0x0100;   // left shoulder
    if (s->strum_up)   b |= 0x0001;
    if (s->strum_down) b |= 0x0002;
    if (s->plus) b |= 0x0010;     // start
    if (s->star) b |= 0x0020;     // back
    // Fortnite Festival on PC reads overdrive from D-pad left
    if (s->star && (g_cfg.flags & CFG_FLAG_STAR_DPAD_LEFT)) b |= 0x0004;
    memset(out, 0, XINPUT_REPORT_LEN);
    out[1] = XINPUT_REPORT_LEN;
    out[2] = (uint8_t)b;
    out[3] = (uint8_t)(b >> 8);
    int16_t whammy = xi_axis(s->whammy);
    out[10] = (uint8_t)whammy;
    out[11] = (uint8_t)((uint16_t)whammy >> 8);
    int16_t tilt = s->star ? 32767 : -32768;   // games read star power from the tilt axis too
    out[12] = (uint8_t)tilt;
    out[13] = (uint8_t)((uint16_t)tilt >> 8);
    return XINPUT_REPORT_LEN;
}

// ---- PS3 Guitar Hero guitar, 27 byte report (layout matches the descriptor)
static uint16_t build_ps3(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS3_REPORT_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (s->yellow) b0 |= 0x01;
    if (s->green)  b0 |= 0x02;
    if (s->red)    b0 |= 0x04;
    if (s->blue)   b0 |= 0x08;
    if (s->orange) b0 |= 0x10;
    if (s->star) b1 |= 0x01;      // select
    if (s->plus) b1 |= 0x02;      // start
    out[0] = b0;
    out[1] = b1;
    // hat: 0 = up, 4 = down, 8 = neutral
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[2] = hat;
    out[3] = 0x80;                // left stick x
    out[4] = 0x80;                // left stick y
    // Real GH guitars rest the whammy at 0x80 and go up to 0xFF (Santroller 24e78967: 0x80 + (v >> 9) of 16 bits)
    out[5] = (uint8_t)(0x80 + (s->whammy >> 8));   // whammy is 0..32767: 0x80..0xFF
    out[6] = 0x80;                // touch slider idle
    // Fret pressures are 0 or 0xFF like a real guitar (Santroller 6f3d291f): yellow, (left, unused), green / strum
    // up, orange / strum down, blue, red. A fret sharing a byte with its strum direction reads 0 when both are held.
    out[7]  = s->yellow ? 0xFF : 0x00;
    out[9]  = (s->green  != (s->strum_up   && !s->strum_down)) ? 0xFF : 0x00;
    out[10] = (s->orange != (s->strum_down && !s->strum_up))   ? 0xFF : 0x00;
    out[11] = s->blue ? 0xFF : 0x00;
    out[12] = s->red ? 0xFF : 0x00;
    // accelerometer words centred (tilt, z, y, unused)
    for (int i = 0; i < 4; i++) {
        out[19 + 2 * i] = 0x00;
        out[20 + 2 * i] = 0x02;   // 0x0200
    }
    return PS3_REPORT_LEN;
}

// ---- PS3 Rock Band guitar, 27 byte report (Santroller's PS3RockBandGuitar_Data_t layout)
// byte 0: blue, green, red, yellow, orange, tilt(R1), solo(L2), -   byte 1: select, start
// byte 2: hat (strum), 3/4: sticks, 5: whammy (0 = rest), 6: pickup selector, accel words centred.
static uint16_t build_ps3_rb(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS3_REPORT_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (s->blue)   b0 |= 0x01;
    if (s->green)  b0 |= 0x02;
    if (s->red)    b0 |= 0x04;
    if (s->yellow) b0 |= 0x08;
    if (s->orange) b0 |= 0x10;
    if (s->tilt)   b0 |= 0x20;    // Rock Band reads tilt as R1
    // overdrive: the star button is select; with no separate tilt reading it also tilts (star = select)
    if (s->star) b1 |= 0x01;      // select
    if (s->plus) b1 |= 0x02;      // start
    out[0] = b0;
    out[1] = b1;
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[2] = hat;
    out[3] = 0x80;
    out[4] = 0x80;
    out[5] = (uint8_t)(s->whammy >> 7);
    out[6] = 0x00;                // pickup selector position
    for (int i = 0; i < 4; i++) {
        out[19 + 2 * i] = 0x00;
        out[20 + 2 * i] = 0x02;   // 0x0200
    }
    return PS3_REPORT_LEN;
}

// ---- USB keyboard, 8 byte boot report (Fortnite Festival keyboard bindings by default)
static uint16_t build_keyboard(const pad_t *s, uint8_t *out) {
    memset(out, 0, KEYBOARD_REPORT_LEN);
    const bool on[NUM_KEYS] = {s->green, s->red, s->yellow, s->blue, s->orange, s->strum_up, s->strum_down,
                               s->star && !s->tilt, s->plus, s->tilt, s->whammy > 16384};
    int n = 0;
    for (int k = 0; k < NUM_KEYS; k++) {
        uint8_t code = g_cfg.keys[k];
        if (!on[k] || code == 0) continue;
        if (code >= 0xE0 && code <= 0xE7) { out[0] |= (uint8_t)(1u << (code - 0xE0)); continue; }
        bool dup = false;
        for (int i = 0; i < n; i++) if (out[2 + i] == code) dup = true;
        if (!dup && n < 6) out[2 + n++] = code;
    }
    return KEYBOARD_REPORT_LEN;
}

// ---- Nintendo Switch (HORIPAD layout), 8 byte report
static uint16_t build_switch(const pad_t *s, uint8_t *out) {
    uint16_t b = 0;
    if (s->blue)   b |= 1u << 0;   // Y   (yellow is X and blue is Y, as in Santroller beb9b937)
    if (s->red)    b |= 1u << 1;   // B
    if (s->green)  b |= 1u << 2;   // A
    if (s->yellow) b |= 1u << 3;   // X
    if (s->orange) b |= 1u << 4;   // L
    if (s->tilt)   b |= 1u << 5;   // R
    if (s->star)   b |= 1u << 8;   // minus
    if (s->plus)   b |= 1u << 9;   // plus
    out[0] = (uint8_t)b;
    out[1] = (uint8_t)(b >> 8);
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[2] = hat;
    out[3] = 0x80; out[4] = 0x80;
    // right stick X = whammy: rests at the stick centre and pushes down toward the minimum (Santroller beb9b937)
    uint8_t wh = (uint8_t)(0x80 - (s->whammy >> 8));   // 0..32767 -> 0x80..0x01
    out[5] = wh ? wh : 0x01;
    out[6] = 0x80;
    out[7] = 0x00;
    return SWITCH_REPORT_LEN;
}

// ---- original Xbox ("Duke"), 20 byte report
static uint16_t build_ogxbox(const pad_t *s, uint8_t *out) {
    memset(out, 0, OGXBOX_REPORT_LEN);
    out[1] = OGXBOX_REPORT_LEN;
    uint8_t d = 0;
    if (s->strum_up)   d |= 0x01;
    if (s->strum_down) d |= 0x02;
    if (s->plus)       d |= 0x10;   // start
    if (s->star)       d |= 0x20;   // back
    out[2] = d;
    out[4] = s->green ? 0xFF : 0;   // A
    out[5] = s->red ? 0xFF : 0;     // B
    out[6] = s->blue ? 0xFF : 0;    // X
    out[7] = s->yellow ? 0xFF : 0;  // Y
    out[8] = s->orange ? 0xFF : 0;  // black
    out[9] = s->tilt ? 0xFF : 0;    // white
    int16_t whammy = xi_axis(s->whammy);
    out[16] = (uint8_t)whammy; out[17] = (uint8_t)((uint16_t)whammy >> 8);   // right stick X
    return OGXBOX_REPORT_LEN;
}

// ---- generic HID gamepad, 7 byte report
static uint16_t build_hid(const pad_t *s, uint8_t *out) {
    uint16_t b = 0;
    if (s->green)  b |= 1u << 0;
    if (s->red)    b |= 1u << 1;
    if (s->yellow) b |= 1u << 2;
    if (s->blue)   b |= 1u << 3;
    if (s->orange) b |= 1u << 4;
    if (s->star)   b |= 1u << 5;
    if (s->plus)   b |= 1u << 6;
    if (s->strum_up)   b |= 1u << 7;
    if (s->strum_down) b |= 1u << 8;
    uint8_t hat = 0x08;           // neutral (8 = null state)
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[0] = (uint8_t)b;
    out[1] = (uint8_t)(b >> 8);
    out[2] = hat;
    out[3] = 0x80;
    out[4] = 0x80;
    out[5] = (uint8_t)(s->whammy >> 7);
    // Rz follows the tilt sensor only. Pressing star power moves button 6 alone, so a game binding it
    // (Clone Hero's remap screen) records a plain button with a label, not an unnamed axis.
    // Tilt still presses button 6 too (folded into `star`), so it needs no separate binding.
    out[6] = s->tilt ? 0xFF : 0x00;
    return HID_REPORT_LEN;
}

// ---- PS4 Rock Band 4-style guitar, 64 byte DualShock 4 report (report id 1).
// Layout as Santroller's PS4RockBandGuitar_Data_t / GP2040-CE's PS4Report guitar union.
static uint16_t build_ps4(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS4_GUITAR_REPORT_LEN);
    out[0] = 0x01;
    out[1] = out[2] = out[3] = out[4] = 0x80;          // sticks centred
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    uint8_t b5 = hat;
    if (s->blue)   b5 |= 0x10;                          // square
    if (s->green)  b5 |= 0x20;                          // cross
    if (s->red)    b5 |= 0x40;                          // circle
    if (s->yellow) b5 |= 0x80;                          // triangle
    uint8_t b6 = 0;
    if (s->orange) b6 |= 0x01;                          // L1
    if (s->star)   b6 |= 0x10;                          // share = overdrive
    if (s->plus)   b6 |= 0x20;                          // options
    out[5] = b5;
    out[6] = b6;
    out[30] = 0x1B;                                     // cable connected, battery full (as a wired DS4)
    out[43] = 0x00;                                     // pickup selector notch
    out[44] = (uint8_t)(s->whammy >> 7);               // whammy, 0 = rest
    out[45] = s->tilt ? 0xFF : 0x00;                    // tilt
    out[46] = (uint8_t)((s->green ? 0x01 : 0) | (s->red ? 0x02 : 0) | (s->yellow ? 0x04 : 0) |
                        (s->blue ? 0x08 : 0) | (s->orange ? 0x10 : 0));
    return PS4_GUITAR_REPORT_LEN;
}

// ---- PS2 Guitar Hero guitar on the controller port (Santroller's PS2GuitarHeroGuitar_Data_t, active high;
// the PSX layer puts it on the wire). The frets are the shoulder / face buttons like a real GH guitar, strum on
// the D-pad (with the guitar's D-pad left identifier held), whammy on the left stick, star power on select.
static void build_ps2(const pad_t *s, uint8_t *out) {
    static const uint8_t dpad[16] = {0x80, 0x23, 0xaa, 0x20, 0x58, 0x1c, 0x4b, 0x1a, 0xec, 0x23, 0xa1, 0x20, 0x55, 0x1b, 0x49, 0x1a};
    uint8_t b0 = 0x80;                                  // D-pad left: "this is a guitar"
    if (s->star)       b0 |= 0x01;                      // select
    if (s->plus)       b0 |= 0x08;                      // start
    if (s->strum_up)   b0 |= 0x10;
    if (s->strum_down) b0 |= 0x40;
    uint8_t b1 = 0;
    if (s->tilt)   b1 |= 0x01;                          // L2
    if (s->green)  b1 |= 0x02;                          // R2
    if (s->yellow) b1 |= 0x10;                          // triangle
    if (s->red)    b1 |= 0x20;                          // circle
    if (s->blue)   b1 |= 0x40;                          // cross
    if (s->orange) b1 |= 0x80;                          // square
    out[0] = b0;
    out[1] = b1;
    out[2] = dpad[(s->strum_up ? 1 : 0) | (s->strum_down ? 2 : 0)];   // the guitar's D-pad lives on the right stick
    out[3] = 0;
    out[4] = 0;                                         // touch slider
    out[5] = (uint8_t)(0x7F - (s->whammy >> 8));        // whammy, 0x7F = rest
}

// ---- Wii Guitar Hero guitar extension, data format 3 (Santroller's WiiGuitarDataFormat3_t). Buttons are
// active low; strum on the D-pad, star power on minus, whammy 5 bits with 0 at rest
static void build_wii_ext(const pad_t *s, uint8_t *out) {
    uint8_t lo = 0, hi = 0;
    if (s->plus)       lo |= 0x04;                      // plus
    if (s->star)       lo |= 0x10;                      // minus = star power
    if (s->strum_down) lo |= 0x40;
    if (s->strum_up)   hi |= 0x01;
    if (s->yellow)     hi |= 0x08;
    if (s->green)      hi |= 0x10;
    if (s->blue)       hi |= 0x20;
    if (s->red)        hi |= 0x40;
    if (s->orange)     hi |= 0x80;
    out[0] = 32;                                        // stick centred (6 bits)
    out[1] = 32;
    out[2] = 0x0F;                                      // touch bar: not touched
    out[3] = (uint8_t)(s->whammy >> 10);                // 0..31
    out[4] = (uint8_t)~lo;
    out[5] = (uint8_t)~hi;
}

// ---- PS5 Rock Band guitar, 64 byte report (Santroller's PS5RockBandGuitar_Data_t). It goes to the P5General,
// which hands back the copy the console accepts.
static uint16_t build_ps5(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS5_REPORT_LEN);
    out[0] = 0x01;
    out[1] = out[2] = out[3] = out[4] = 0x80;          // sticks centred
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    uint8_t b8 = hat;
    if (s->blue)   b8 |= 0x10;                          // square
    if (s->green)  b8 |= 0x20;                          // cross
    if (s->red)    b8 |= 0x40;                          // circle
    if (s->yellow) b8 |= 0x80;                          // triangle
    uint8_t b9 = 0;
    if (s->orange) b9 |= 0x01;                          // L1
    if (s->star)   b9 |= 0x10;                          // create = overdrive
    if (s->plus)   b9 |= 0x20;                          // options
    out[8] = b8;
    out[9] = b9;
    out[30] = 0x1A;                                     // as a DualSense
    out[40] = 0x00;                                     // pickup selector notch
    out[41] = (uint8_t)(s->whammy >> 7);               // whammy, 0 = rest
    out[42] = s->tilt ? 0xFF : 0x00;                    // tilt
    out[43] = (uint8_t)((s->green ? 0x01 : 0) | (s->red ? 0x02 : 0) | (s->yellow ? 0x04 : 0) |
                        (s->blue ? 0x08 : 0) | (s->orange ? 0x10 : 0));
    return PS5_REPORT_LEN;
}

// ---- Xbox One Rock Band 4-style guitar: 32 byte GIP input body (Santroller's XboxOneRockBandGuitar_Data_t)
static void build_xbone(const pad_t *s, uint8_t *out) {
    memset(out, 0, XBONE_GUITAR_PAYLOAD_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (s->plus)   b0 |= 0x04;                          // menu
    if (s->star)   b0 |= 0x08;                          // view = overdrive
    if (s->green)  b0 |= 0x10;                          // A
    if (s->red)    b0 |= 0x20;                          // B
    if (s->blue)   b0 |= 0x40;                          // X
    if (s->yellow) b0 |= 0x80;                          // Y
    if (s->strum_up)   b1 |= 0x01;
    if (s->strum_down) b1 |= 0x02;
    if (s->orange) b1 |= 0x10;                          // LB
    out[0] = b0;
    out[1] = b1;
    out[2] = s->tilt ? 0xFF : 0x00;                     // tilt
    out[3] = (uint8_t)(s->whammy >> 7);                // whammy
    out[4] = 0x00;                                      // pickup selector
    out[5] = (uint8_t)((s->green ? 0x01 : 0) | (s->red ? 0x02 : 0) | (s->yellow ? 0x04 : 0) |
                       (s->blue ? 0x08 : 0) | (s->orange ? 0x10 : 0));
}

