#include "padmap.h"
#include "input.h"      // atilt_press

static bool sens_on[NUM_ATILT];   // 4 % hysteresis of a sensor mapped explicitly

void padmap_reset(void) { sens_on[0] = sens_on[1] = false; }

static const uint8_t k_default[NUM_SRC] = {
    OUT_A, OUT_B, OUT_Y, OUT_X, OUT_LB, OUT_DUP, OUT_DDOWN, OUT_BACK, OUT_START,
    OUT_RX,                      // whammy
    0xFF, 0xFF, 0xFF,            // tilt switch, sensors: the Tune page behaviour, not an output
    OUT_DUP, OUT_DDOWN, OUT_DLEFT, OUT_DRIGHT, OUT_BACK, OUT_GUIDE, OUT_LX, OUT_LY, OUT_L3};

uint8_t padmap_default_out(int src) { return src >= 0 && src < NUM_SRC ? k_default[src] : 0; }

static inline int32_t iabs(int32_t v) { return v < 0 ? -v : v; }

// several sources on one axis: the value farthest from the neutral position (0) wins
static inline void acc(int16_t *a, int32_t c) {
    if (c > 32767) c = 32767;
    if (c < -32767) c = -32767;
    if (iabs(c) > iabs(*a)) *a = (int16_t)c;
}

int16_t padmap_cal_axis(uint16_t raw, uint16_t mn, uint16_t md, uint16_t mx, uint8_t dz) {
    if (!(mn < md && md < mx)) return 0;
    int32_t v;
    if (raw >= md) { v = ((int32_t)(raw - md) * 32767) / (mx - md); if (v > 32767) v = 32767; }
    else           { v = -(((int32_t)(md - raw) * 32767) / (md - mn)); if (v < -32767) v = -32767; }
    int32_t d = 32767 * (int32_t)(dz > 50 ? 50 : dz) / 100, m = iabs(v);
    if (m <= d) return 0;
    m = ((m - d) * 32767) / (32767 - d);
    return (int16_t)(v < 0 ? -m : m);
}

void padmap_build(const padsrc_t *s, const uint8_t *row, gpad_t *g) {
    uint32_t dig = s->dig;
    int16_t whammy = s->whammy;
    bool tilt = false;
    // Tune page behaviour of the tilt inputs whose entry is the mode default: they press their function
    // (star power by default) and a sensor can add to the whammy; an explicit entry replaces all that for this mode
    for (int i = 0; i < 3; i++) {
        if (row && row[SRC_TILT_SW + i] != MAP_DEFAULT) continue;
        int f = s->tilt_fn[i];
        if (f == F_STAR) tilt = true;
        else if (f >= 0 && f < NUM_FUNCS) dig |= 1u << f;
        if (i > 0 && s->sens_whammy[i - 1] > whammy) whammy = s->sens_whammy[i - 1];
    }
    if (tilt) dig |= 1u << SRC_STAR;

    uint32_t btn = 0;
    int16_t ax[6] = {0, 0, 0, 0, 0, 0};
    uint8_t driven = 0;
    for (int src = 0; src < NUM_SRC; src++) {
        uint8_t o = row ? row[src] : MAP_DEFAULT;
        if (o == MAP_DEFAULT) o = k_default[src];
        // sensors keep their press hysteresis whenever they are mapped explicitly
        bool analog = false, bipolar = false;
        int32_t a = 0;
        bool p = false;
        switch (src) {
            case SRC_WHAMMY:   analog = true; a = whammy; p = a > 16383; break;
            case SRC_TILT_S1:
            case SRC_TILT_S2: {
                int i = src - SRC_TILT_S1;
                analog = true; a = s->sens[i];
                if (o == 0 || o == MAP_DEFAULT) { sens_on[i] = false; p = false; }
                else p = sens_on[i] = atilt_press(sens_on[i], a, s->sens_thr[i]);
                break;
            }
            case SRC_STICK_X:
            case SRC_STICK_Y:  analog = bipolar = true; a = s->stick[src - SRC_STICK_X]; p = iabs(a) > 16383; break;
            default:           p = (dig >> src) & 1u; break;
        }
        if (o == 0 || o == MAP_DEFAULT || o >= NUM_OUT) continue;
        if (o <= OUT_DRIGHT) { if (p) btn |= 1u << (o - 1); continue; }
        int idx = o - OUT_LX, sign = 0;
        if (o >= OUT_LXM) { idx = (o - OUT_LXM) >> 1; sign = (o & 1) ? 1 : -1; }   // 24 LX-, 25 LX+, 26 LY- ...
        int32_t c;
        if (!analog)     c = p ? 32767 : 0;                              // pressed = the extreme
        else if (sign)   c = iabs(a);
        else if (idx >= 4) c = iabs(a);                                  // trigger: 0..1 (a stick: |value|)
        else             c = bipolar ? a : 2 * a - 32767;                // 0..1 -> the stick's full range
        if (sign) c = sign * c;
        acc(&ax[idx], c);
        driven |= (uint8_t)(1u << idx);
    }
    // a digital LT / RT is also a full trigger; an analog trigger past half also presses the digital one
    if ((btn >> (OUT_LT_BTN - 1)) & 1u) acc(&ax[4], 32767);
    if ((btn >> (OUT_RT_BTN - 1)) & 1u) acc(&ax[5], 32767);
    if (ax[4] > 16383) btn |= 1u << (OUT_LT_BTN - 1);
    if (ax[5] > 16383) btn |= 1u << (OUT_RT_BTN - 1);
    g->btn = btn;
    g->lx = ax[0]; g->ly = ax[1]; g->rx = ax[2]; g->ry = ax[3]; g->lt = ax[4]; g->rt = ax[5];
    g->driven = driven;
    g->tilt = tilt;
}
