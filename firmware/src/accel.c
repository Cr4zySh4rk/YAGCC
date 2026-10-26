// I2C accelerometer for tilt. Detection, addresses, register setup and the sample filters follow Santroller's
// accelerometerlib (sanjay900/Santroller lib/accelerometer, up to 7a40ba4e "add filters back to
// accelerometers"): LIS3DH / SC7A20 / LIS3DSH, ADXL345, MPU-6050 and its register compatible clones, each set
// up so that 1 g reads as about 16384, polled together with the chip's data ready flag so every sample is
// filtered exactly once, then
//   1. a gravity gate (samples whose total acceleration is too far from 1 g, like a strum bar hit, are
//      dropped and the last good one held, for at most 250 ms),
//   2. a median of the last 3..9 samples,
//   3. a 2nd order Butterworth low pass (Zavalishin's topology preserving state variable filter, its
//      coefficients following the measured sample period),
// each off when its setting is 0. The LIS3DH's three auxiliary ADC inputs are read too.
// A second chip can share the bus at a different address (ADXL345 0x53 + 0x1D, LIS3DH 0x18 + 0x19, MPU-6050
// 0x68 + 0x69, or any mix): each has its own filter state and its own unplug / re-detect, polled half a period
// apart, one transfer per accel_task() call.
// Santroller drives the bus from DMA; here each step is one short transfer with a timeout, spread over main
// loop passes (a poll is an 8 byte read, about 0.25 ms at 400 kHz, every 1 ms).
#include "accel.h"
#include "config.h"
#include <math.h>
#include <string.h>
#include "pico/stdlib.h"
#include "hardware/i2c.h"
#include "hardware/gpio.h"

#define ACCEL_I2C_HZ        400000
#define ACCEL_POLL_US       1000      // faster than the chips' 200..400 Hz output, the data ready flag picks new samples
#define ACCEL_PROBE_STEP_US 80000     // while a slot is empty, try its next candidate address this often (6 addresses ~ 0.5 s)
#define ACCEL_XFER_US       2000      // per transfer timeout
#define ACCEL_MAX_FAILS     10        // consecutive failed polls before probing again (Santroller: 10)
#define ACCEL_STALE_US      1000000   // no new sample this long: the chip stopped, probe again
#define ACCEL_1G            16384.0f
#define ACCEL_GATE_MAX_US   250000    // stop gating after this long, so constant shaking can't freeze the output
#define ACCEL_RESTART_US    100000    // a gap this long between samples starts the filters again
#define MEDIAN_MAX          9

// LIS3DH family
#define LIS3DH_ADDR1 0x18
#define LIS3DH_ADDR2 0x19
#define LIS3DH_WHOAMI 0x0F
#define LIS3DH_ID  0x33
#define SC7A20_ID  0x11
#define LIS3DSH_ID 0x3F
#define LIS3DH_CTRL1 0x20
#define LIS3DH_CTRL4 0x23
#define LIS3DH_TEMPCFG 0x1F
#define LIS3DH_STATUS_AI (0x27 | 0x80)   // status, then the outputs, auto increment
#define LIS3DH_ZYXDA 0x08
#define LIS3DH_OUTADC1_AI (0x08 | 0x80)
// ADXL345
#define ADXL_ADDR1 0x53
#define ADXL_ADDR2 0x1D
#define ADXL_DEVID 0x00
#define ADXL_ID 0xE5
#define ADXL_BW_RATE 0x2C
#define ADXL_POWER_CTL 0x2D
#define ADXL_INT_SOURCE 0x30             // interrupt source, data format, then the outputs
#define ADXL_DATA_READY 0x80
#define ADXL_DATA_FORMAT 0x31
// MPU-6050
#define MPU_ADDR1 0x68
#define MPU_ADDR2 0x69
#define MPU_WHOAMI 0x75
#define MPU_PWR_MGMT_1 0x6B
#define MPU_ACCEL_CONFIG 0x1C
#define MPU_CONFIG 0x1A
#define MPU_INT_ENABLE 0x38
#define MPU_INT_STATUS 0x3A              // followed by ACCEL_XOUT_H at 0x3B
#define MPU_DATA_RDY 0x01

#define NUM_ACCEL 2

typedef struct {
    uint8_t type, addr;
    uint32_t next_us, last_new_us;
    uint8_t fails, probe_idx;
    int32_t out[3];                  // filtered, 1 g = 16384
    bool have_sample;
    uint16_t lis_adc[3];             // LIS3DH aux ADC, left justified signed 10 bit (chip 1 only)
    bool have_adc;
    // filter state
    bool filter_started;
    uint32_t last_sample_us, gated_since_us;
    float sample_period, lp_period, lp_a1, lp_a2, lp_a3;
    bool gated;
    int32_t median_ring[3][MEDIAN_MAX];
    uint8_t median_pos, median_n;
    float lp_ic1[3], lp_ic2[3];
} accel_dev_t;

static i2c_inst_t *bus;
static int8_t cur_sda = -1, cur_scl = -1;
static accel_dev_t dev[NUM_ACCEL];

uint8_t accel_type(void) { return dev[0].type; }
uint8_t accel_type_n(int n) { return n >= 0 && n < NUM_ACCEL ? dev[n].type : ACCEL_NONE; }
bool accel_pin(int gpio) { return gpio >= 0 && (gpio == cur_sda || gpio == cur_scl); }

static int32_t to12(int32_t v) {      // signed 16 bit -> 12 bit reading, 2048 = 0
    v = (v + 32768) >> 4;
    return v < 0 ? 0 : v > 4095 ? 4095 : v;
}
int32_t accel_raw12_n(int n, int axis) {
    if (n < 0 || n >= NUM_ACCEL || axis < 0 || axis > 2) return -1;
    const accel_dev_t *s = &dev[n];
    if (!s->type || !s->have_sample) return -1;
    return to12(s->out[axis]);
}
int32_t accel_raw12(int axis) { return accel_raw12_n(0, axis); }
int32_t accel_adc12(int ch) {
    const accel_dev_t *s = &dev[0];
    if (s->type != ACCEL_LIS3DH || !s->have_adc || ch < 0 || ch > 2) return -1;
    return to12((int16_t)s->lis_adc[ch]);
}

static bool wr(uint8_t a, uint8_t reg, uint8_t val) {
    uint8_t b[2] = {reg, val};
    return i2c_write_timeout_us(bus, a, b, 2, false, ACCEL_XFER_US) == 2;
}
static bool rd(uint8_t a, uint8_t reg, uint8_t *dst, size_t n) {
    if (i2c_write_timeout_us(bus, a, &reg, 1, true, ACCEL_XFER_US) != 1) return false;
    return i2c_read_timeout_us(bus, a, dst, n, false, ACCEL_XFER_US) == (int)n;
}

static void clear(accel_dev_t *s) {
    memset(s->out, 0, sizeof(s->out));
    memset(s->lis_adc, 0, sizeof(s->lis_adc));
    s->have_sample = s->have_adc = false;
    s->filter_started = false;
}

static void stop_bus(void) {
    if (bus) i2c_deinit(bus);
    for (int i = 0; i < 2; i++) {
        int p = i ? cur_scl : cur_sda;
        if (p >= 0) { gpio_init(p); gpio_set_dir(p, GPIO_IN); gpio_pull_up(p); }   // back to a plain input
    }
    bus = NULL; cur_sda = cur_scl = -1;
    for (int n = 0; n < NUM_ACCEL; n++) { memset(&dev[n], 0, sizeof(dev[n])); }
}

// SDA on an even GPIO and SCL on the odd one of the same I2C block (GP4 / GP5, GP2 / GP3, ...)
bool accel_pins_ok(uint8_t sda, uint8_t scl) {
    return sda < NUM_DIGITAL_PINS && scl < NUM_DIGITAL_PINS && !(sda & 1) && (scl & 1) && ((sda >> 1) & 1) == ((scl >> 1) & 1);
}

static bool setup_chip(uint8_t t, uint8_t a) {
    switch (t) {
        case ACCEL_LIS3DH:   // 400 Hz, X/Y/Z on; block update, high resolution, +-2 g; aux ADC on
            return wr(a, LIS3DH_CTRL1, 0x77) && wr(a, LIS3DH_CTRL4, 0x88) && wr(a, LIS3DH_TEMPCFG, 0x80);
        case ACCEL_SC7A20:
            return wr(a, LIS3DH_CTRL1, 0x77) && wr(a, LIS3DH_CTRL4, 0x88);
        case ACCEL_LIS3DSH:  // 400 Hz, X/Y/Z on, +-2 g default
            return wr(a, LIS3DH_CTRL1, 0x7F);
        case ACCEL_ADXL345:  // measure; full resolution +-16 g (4 mg per count); 200 Hz, as fast as it should go
            return wr(a, ADXL_POWER_CTL, 0x08) && wr(a, ADXL_DATA_FORMAT, 0x0B) && wr(a, ADXL_BW_RATE, 0x0B);
        case ACCEL_MPU6050: {  // wake, clock from the X gyro (read back so only sleep / clock change); +-2 g;
            uint8_t v;         // 1 kHz with the 184 Hz low pass; data ready flag on (it is only raised when enabled)
            if (!rd(a, MPU_PWR_MGMT_1, &v, 1)) return false;
            return wr(a, MPU_PWR_MGMT_1, (uint8_t)((v & ~0x47) | 0x01)) && wr(a, MPU_ACCEL_CONFIG, 0x00) &&
                   wr(a, MPU_CONFIG, 0x01) && wr(a, MPU_INT_ENABLE, MPU_DATA_RDY);
        }
    }
    return false;
}

// One candidate address per call (so a missing chip costs one short NACKed transfer, not six), in Santroller's
// order: LIS3DH family, ADXL345, MPU-6050. An address the other chip already uses is skipped.
static const uint8_t cand_addr[6] = {LIS3DH_ADDR1, LIS3DH_ADDR2, ADXL_ADDR1, ADXL_ADDR2, MPU_ADDR1, MPU_ADDR2};
static void probe_step(accel_dev_t *s, const accel_dev_t *other) {
    uint8_t idx = s->probe_idx, a = cand_addr[idx], id, t = ACCEL_NONE;
    s->probe_idx = (uint8_t)((idx + 1) % 6);
    if (other->type && other->addr == a) return;
    if (idx < 2) {
        if (rd(a, LIS3DH_WHOAMI, &id, 1)) {
            if (id == LIS3DH_ID) t = ACCEL_LIS3DH;
            else if (id == SC7A20_ID) t = ACCEL_SC7A20;
            else if (id == LIS3DSH_ID) t = ACCEL_LIS3DSH;
        }
    } else if (idx < 4) {
        if (rd(a, ADXL_DEVID, &id, 1) && id == ADXL_ID) t = ACCEL_ADXL345;
    } else {
        if (rd(a, MPU_WHOAMI, &id, 1) && (id == 0x68 || id == 0x98 || id == 0x70)) t = ACCEL_MPU6050;
    }
    if (t && setup_chip(t, a)) {
        s->type = t; s->addr = a; s->fails = 0; clear(s);
        s->last_new_us = time_us_32();
    }
}

static void filter_sample(accel_dev_t *s, const int32_t a[3], uint32_t t) {
    float out[3] = {(float)a[0], (float)a[1], (float)a[2]};
    uint32_t dt = t - s->last_sample_us;
    uint8_t median = g_cfg.accel_median > 1 ? (g_cfg.accel_median > MEDIAN_MAX ? MEDIAN_MAX : g_cfg.accel_median) : 0;
    if (!s->filter_started || dt > ACCEL_RESTART_US || median != s->median_n) {
        s->filter_started = true;
        s->last_sample_us = t;
        s->sample_period = 0;
        s->gated = false;
        s->median_pos = 0;
        s->median_n = median;
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < MEDIAN_MAX; j++) s->median_ring[i][j] = a[i];
            s->lp_ic1[i] = 0;
            s->lp_ic2[i] = out[i];
            s->out[i] = a[i];
        }
        s->have_sample = true;
        return;
    }
    s->last_sample_us = t;
    // samples are timestamped when the poll that found them finishes, so smooth out that jitter
    s->sample_period = s->sample_period ? s->sample_period + ((float)dt - s->sample_period) * 0.05f : (float)dt;
    if (g_cfg.accel_gate) {
        float tol = g_cfg.accel_gate / 100.0f;
        float mag = sqrtf(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
        if (fabsf(mag - ACCEL_1G) > tol * ACCEL_1G) {
            if (!s->gated) { s->gated = true; s->gated_since_us = t; }
            if (t - s->gated_since_us < ACCEL_GATE_MAX_US) return;   // hold the last good sample
        } else {
            s->gated = false;
        }
    }
    if (median) {
        for (int i = 0; i < 3; i++) {
            s->median_ring[i][s->median_pos] = a[i];
            int32_t v3[MEDIAN_MAX];
            memcpy(v3, s->median_ring[i], median * sizeof(int32_t));
            for (int x = 1; x < median; x++) {          // insertion sort, at most 9 values
                int32_t v = v3[x]; int y = x - 1;
                while (y >= 0 && v3[y] > v) { v3[y + 1] = v3[y]; y--; }
                v3[y + 1] = v;
            }
            out[i] = (float)v3[median / 2];
        }
        s->median_pos = (uint8_t)((s->median_pos + 1) % median);
    }
    if (g_cfg.accel_lowpass) {
        if (fabsf(s->sample_period - s->lp_period) > s->lp_period * 0.01f) {
            s->lp_period = s->sample_period;
            float w = (float)M_PI * g_cfg.accel_lowpass * s->sample_period / 1000000.0f;
            float g = tanf(w < 0.45f * (float)M_PI ? w : 0.45f * (float)M_PI);
            float k = (float)M_SQRT2;
            s->lp_a1 = 1.0f / (1.0f + g * (g + k));
            s->lp_a2 = g * s->lp_a1;
            s->lp_a3 = g * s->lp_a2;
        }
        for (int i = 0; i < 3; i++) {
            float v3 = out[i] - s->lp_ic2[i];
            float v1 = s->lp_a1 * s->lp_ic1[i] + s->lp_a2 * v3;
            float v2 = s->lp_ic2[i] + s->lp_a2 * s->lp_ic1[i] + s->lp_a3 * v3;
            s->lp_ic1[i] = 2 * v1 - s->lp_ic1[i];
            s->lp_ic2[i] = 2 * v2 - s->lp_ic2[i];
            out[i] = v2;
        }
    }
    for (int i = 0; i < 3; i++) s->out[i] = lrintf(out[i]);
    s->have_sample = true;
}

static void poll(accel_dev_t *s, bool is_first, uint32_t now) {
    uint8_t b[8] = {0};
    int32_t a[3];
    bool ok, fresh;
    switch (s->type) {
        case ACCEL_ADXL345:     // interrupt source, data format, X0..Z1; 4 mg per count -> 1 g = 16384
            ok = rd(s->addr, ADXL_INT_SOURCE, b, 8);
            fresh = b[0] & ADXL_DATA_READY;
            for (int i = 0; i < 3; i++) a[i] = (int16_t)(b[2 + 2 * i] | b[3 + 2 * i] << 8) * 64;
            break;
        case ACCEL_MPU6050:     // int status, then X/Y/Z big endian
            ok = rd(s->addr, MPU_INT_STATUS, b, 7);
            fresh = b[0] & MPU_DATA_RDY;
            for (int i = 0; i < 3; i++) a[i] = (int16_t)(b[1 + 2 * i] << 8 | b[2 + 2 * i]);
            break;
        default:                // LIS3DH family: status, then X/Y/Z little endian, left justified
            ok = rd(s->addr, LIS3DH_STATUS_AI, b, 7);
            fresh = b[0] & LIS3DH_ZYXDA;
            for (int i = 0; i < 3; i++) a[i] = (int16_t)(b[1 + 2 * i] | b[2 + 2 * i] << 8);
            break;
    }
    if (!ok) {
        if (++s->fails > ACCEL_MAX_FAILS) { s->type = ACCEL_NONE; clear(s); }   // unplugged: look again
        return;
    }
    s->fails = 0;
    if (fresh) {
        for (int i = 0; i < 3; i++) { if (a[i] > 32767) a[i] = 32767; if (a[i] < -32768) a[i] = -32768; }
        filter_sample(s, a, now);
        s->last_new_us = now;
    } else if (now - s->last_new_us > ACCEL_STALE_US) {
        s->type = ACCEL_NONE; clear(s);             // answering but no longer sampling: set it up again
        return;
    }
    if (is_first && s->type == ACCEL_LIS3DH && rd(s->addr, LIS3DH_OUTADC1_AI, b, 6)) {
        for (int i = 0; i < 3; i++) s->lis_adc[i] = (uint16_t)(b[2 * i] | b[2 * i + 1] << 8);
        s->have_adc = true;
    }
}

void accel_task(void) {
    uint8_t sda = g_cfg.accel_sda, scl = g_cfg.accel_scl;
    if (!accel_pins_ok(sda, scl)) { if (bus) stop_bus(); return; }
    if (!bus || sda != cur_sda || scl != cur_scl) {      // first start, or the pins changed in the configurator
        if (bus) stop_bus();
        bus = ((sda >> 1) & 1) ? i2c1 : i2c0;
        i2c_init(bus, ACCEL_I2C_HZ);
        gpio_set_function(sda, GPIO_FUNC_I2C);
        gpio_set_function(scl, GPIO_FUNC_I2C);
        gpio_pull_up(sda);                               // modules have their own pull-ups; these help bare chips
        gpio_pull_up(scl);
        cur_sda = (int8_t)sda; cur_scl = (int8_t)scl;
        uint32_t t0 = time_us_32();
        for (int n = 0; n < NUM_ACCEL; n++) { memset(&dev[n], 0, sizeof(dev[n])); dev[n].next_us = t0; }
    }
    // at most one transfer (or one probe step) per call: a slot that is due goes, the other waits for the next pass
    for (int n = 0; n < NUM_ACCEL; n++) {
        accel_dev_t *s = &dev[n], *other = &dev[1 - n];
        uint32_t now = time_us_32();
        if ((int32_t)(now - s->next_us) < 0) continue;
        if (!s->type) {
            if (n == 1 && !other->type) { s->next_us = now + ACCEL_PROBE_STEP_US; continue; }   // chip 1 is found first
            probe_step(s, other);
            now = time_us_32();
            if (s->type) {   // found: the second chip is polled half a period after the first
                s->next_us = now + (n ? ACCEL_POLL_US : ACCEL_POLL_US / 2);
                if (n == 0) dev[1].next_us = now + ACCEL_PROBE_STEP_US;
            } else {
                s->next_us = now + ACCEL_PROBE_STEP_US;
            }
            return;
        }
        poll(s, n == 0, now);
        s->next_us = now + ACCEL_POLL_US;
        return;
    }
}
