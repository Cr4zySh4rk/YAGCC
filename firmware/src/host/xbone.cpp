// Xbox One guitar with authentication passthrough.
// Protocol handling is a port of GP2040-CE (src/drivers/xbone/XBOneDriver.cpp, XBOneAuthUSBListener.cpp,
// MIT licence, Copyright (c) 2024 OpenStickCommunity). The guitar identity (announce + GIP descriptor of a
// Mad Catz Stratocaster) and the input layout come from Santroller (src/emulation/usb/xone_device.cpp,
// GPL-3.0).
//
// Genuine Microsoft / PowerA / Brook controllers: auth packets are relayed raw in both directions and the
// controller produces the ACKs. Mayflash-style dongles: messages are reassembled and re-chunked.
#include <string.h>
#include "tusb.h"
#include "device/usbd_pvt.h"
#include "host/usbh.h"
#include "pico/time.h"
#include "pico/unique_id.h"
#include "pico/util/queue.h"
#include "xbone.h"
#include "gip_defs.h"
#include "xgip_protocol.h"
#include "xinput_host.h"

static inline uint32_t now_ms() { return to_ms_since_boot(get_absolute_time()); }

// ---------------------------------------------------------------- guitar identity (Santroller)
static const uint8_t announce_guitar[] = {
    0x7e, 0xed, 0x81, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x6f, 0x0e, 0x48, 0x02,
    0x01, 0x00, 0x00, 0x00, 0xe5, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00};
static const uint8_t xb1_descriptor_guitar[] = {
    0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x01,
    0xC6, 0x00, 0x16, 0x00, 0x1B, 0x00, 0x1C, 0x00, 0x23, 0x00, 0x29, 0x00, 0x75, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x06, 0x01, 0x02, 0x03,
    0x04, 0x06, 0x07, 0x05, 0x01, 0x04, 0x05, 0x06, 0x0A, 0x02, 0x20, 0x00, 0x4D, 0x61, 0x64, 0x43,
    0x61, 0x74, 0x7A, 0x2E, 0x58, 0x62, 0x6F, 0x78, 0x2E, 0x47, 0x75, 0x69, 0x74, 0x61, 0x72, 0x2E,
    0x53, 0x74, 0x72, 0x61, 0x74, 0x6F, 0x63, 0x61, 0x73, 0x74, 0x65, 0x72, 0x27, 0x00, 0x57, 0x69,
    0x6E, 0x64, 0x6F, 0x77, 0x73, 0x2E, 0x58, 0x62, 0x6F, 0x78, 0x2E, 0x49, 0x6E, 0x70, 0x75, 0x74,
    0x2E, 0x4E, 0x61, 0x76, 0x69, 0x67, 0x61, 0x74, 0x69, 0x6F, 0x6E, 0x43, 0x6F, 0x6E, 0x74, 0x72,
    0x6F, 0x6C, 0x6C, 0x65, 0x72, 0x05, 0x38, 0xE4, 0x2A, 0x0D, 0x7D, 0x7F, 0x33, 0x49, 0x86, 0x93,
    0x30, 0xFC, 0x55, 0x01, 0x8E, 0x77, 0xE7, 0x1F, 0xF3, 0xB8, 0x86, 0x73, 0xE9, 0x40, 0xA9, 0xF8,
    0x2F, 0x21, 0x26, 0x3A, 0xCF, 0xB7, 0x56, 0xFF, 0x76, 0x97, 0xFD, 0x9B, 0x81, 0x45, 0xAD, 0x45,
    0xB6, 0x45, 0xBB, 0xA5, 0x26, 0xD6, 0x77, 0xCE, 0x34, 0x7A, 0xE2, 0x7D, 0xC6, 0x45, 0x8C, 0xA4,
    0x00, 0x42, 0xC0, 0x8B, 0xD9, 0x4A, 0xFE, 0xD2, 0xDD, 0xEC, 0x87, 0xD3, 0x94, 0x42, 0xBD, 0x96,
    0x1A, 0x71, 0x2E, 0x3D, 0xC7, 0x7D, 0x02, 0x17, 0x00, 0x20, 0x20, 0x00, 0x01, 0x00, 0x14, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x00,
    0x21, 0x05, 0x00, 0x01, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00};

// Host-side power-up sequence (GP2040-CE)
static const uint8_t XBOXONE_POWER_ON[] = {0x06, 0x62, 0x45, 0xb8, 0x77, 0x26, 0x2c, 0x55, 0x53, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f};
static const uint8_t XBOXONE_POWER_ON_SINGLE[] = {0x00};
static const uint8_t XBOXONE_RUMBLE_ON[] = {0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xeb};
static const uint8_t XBOXONE_LED_ON[] = {0x00, 0x01, 0x14};
static const uint8_t authReady[] = {0x01, 0x00};
static const uint8_t xb1_guide_on[] = {0x01, 0x5b};
static const uint8_t xb1_guide_off[] = {0x00, 0x5b};

// ---------------------------------------------------------------- shared auth state
typedef enum { AUTH_IDLE, CONSOLE_TO_DONGLE, WAIT_CONSOLE_TO_DONGLE, DONGLE_TO_CONSOLE, WAIT_DONGLE_TO_CONSOLE } xauth_state_t;

typedef struct {
    uint8_t data[1024];
    uint16_t length;
    uint8_t sequence, type;
    bool set;
} auth_buffer_t;

typedef struct { uint8_t data[64]; uint16_t len; } relay_packet_t;

static auth_buffer_t consoleBuffer, dongleBuffer;
static volatile xauth_state_t xboneState = AUTH_IDLE;
static volatile bool authCompleted, dongle_ready, passthrough_enabled, passthrough;
static volatile bool deviceMounted, consoleAuthOrphaned, reconnectRequested;
static queue_t relayToDevice, relayToConsole;

static void buf_set(auth_buffer_t *b, const uint8_t *d, uint16_t len, uint8_t seq, uint8_t type) {
    if (len > sizeof(b->data)) len = sizeof(b->data);
    memcpy(b->data, d, len);
    b->length = len; b->sequence = seq; b->type = type; b->set = true;
}
static void buf_reset(auth_buffer_t *b) { b->length = 0; b->sequence = b->type = 0; b->set = false; }

// ---------------------------------------------------------------- device side
typedef enum { READY_ANNOUNCE, WAIT_DESCRIPTOR_REQUEST, SEND_DESCRIPTOR, SETUP_AUTH, AUTH_DONE, NOT_READY } dstate_t;

static dstate_t drvState = NOT_READY;
static uint8_t ep_in, ep_out;
static CFG_TUSB_MEM_ALIGN uint8_t epout_buf[64];
static CFG_TUSB_MEM_ALIGN uint8_t epin_buf[64];
static XGIPProtocol *inXGIP, *outXGIP;
// Fragments of a chunked message get their own parser: a parse of any ordinary packet (input, keepalive, LED) resets
// the parser, so one arriving between two fragments would drop the half-built message (Santroller 0dbb322b).
static XGIPProtocol *inChunkXGIP;
static inline bool gip_is_fragment(const uint8_t *p, uint16_t len) { return len >= 2 && (p[1] & 0x80); }   // GipHeader_t.chunked
static bool waiting_ack;
static uint32_t waiting_ack_since, announce_timer, keep_alive_timer, last_queue_send;
static uint8_t keep_alive_seq = 1, report_seq = 0, keycode_seq = 0;
static bool guide_down;
static uint8_t last_payload[XBONE_GUITAR_PAYLOAD_LEN];
static bool have_last;

#define QDEPTH 16
static relay_packet_t txq[QDEPTH];
static uint8_t txq_head, txq_count;

static void queue_report(const uint8_t *r, uint16_t len) {
    if (txq_count == QDEPTH || len > 64) return;
    uint8_t i = (uint8_t)((txq_head + txq_count) % QDEPTH);
    memcpy(txq[i].data, r, len);
    txq[i].len = len;
    txq_count++;
}

static bool send_usb(const uint8_t *r, uint16_t len) {
    if (!tud_ready() || ep_in == 0 || usbd_edpt_busy(0, ep_in) || len > sizeof(epin_buf)) return false;
    if (!usbd_edpt_claim(0, ep_in)) return false;
    memcpy(epin_buf, r, len);
    if (!usbd_edpt_xfer(0, ep_in, epin_buf, len)) { usbd_edpt_release(0, ep_in); return false; }
    return true;
}

void xbone_init(void) {
    if (!inXGIP) { inXGIP = new XGIPProtocol(); outXGIP = new XGIPProtocol(); inChunkXGIP = new XGIPProtocol(); }
    queue_init(&relayToDevice, sizeof(relay_packet_t), 24);
    queue_init(&relayToConsole, sizeof(relay_packet_t), 24);
    buf_reset(&consoleBuffer); buf_reset(&dongleBuffer);
}

void xbone_dev_reset(void) {
    ep_in = ep_out = 0;
    txq_head = txq_count = 0;
    drvState = NOT_READY;
    announce_timer = now_ms();
}

uint16_t xbone_dev_open(uint8_t rhport, tusb_desc_interface_t const *itf, uint16_t max_len) {
    if (itf->bInterfaceClass != TUSB_CLASS_VENDOR_SPECIFIC || itf->bInterfaceSubClass != 0x47 || itf->bInterfaceProtocol != 0xD0) return 0;
    const uint16_t len = 9 + 7 + 7;
    TU_VERIFY(max_len >= len, 0);
    TU_ASSERT(usbd_open_edpt_pair(rhport, tu_desc_next((uint8_t const *)itf), 2, TUSB_XFER_INTERRUPT, &ep_out, &ep_in), 0);
    usbd_edpt_xfer(rhport, ep_out, epout_buf, sizeof(epout_buf));
    if (inXGIP) { inXGIP->reset(); outXGIP->reset(); inChunkXGIP->reset(); }
    drvState = READY_ANNOUNCE;
    announce_timer = now_ms();
    authCompleted = false;
    have_last = false;
    return len;
}

static void load_descriptor_reply(uint8_t seq) {
    outXGIP->reset();
    outXGIP->setAttributes(GIP_DEVICE_DESCRIPTOR, seq, 1, 1, 0);
    outXGIP->setData(xb1_descriptor_guitar, sizeof(xb1_descriptor_guitar));
    drvState = SEND_DESCRIPTOR;
}

bool xbone_dev_xfer(uint8_t rhport, uint8_t ep_addr, xfer_result_t result, uint32_t bytes) {
    (void)result;
    if (ep_addr != ep_out || !inXGIP) return true;
    XGIPProtocol *in = gip_is_fragment(epout_buf, (uint16_t)bytes) ? inChunkXGIP : inXGIP;
    in->parse(epout_buf, (uint16_t)bytes);
    uint8_t command = in->getCommand();

    if ((command == GIP_AUTH || command == GIP_FINAL_AUTH) && !deviceMounted) consoleAuthOrphaned = true;

    // Raw relay of auth traffic; the controller on the host port generates the ACKs
    if (passthrough_enabled && xbone_is_auth_packet(epout_buf, (uint16_t)bytes)) {
        passthrough = true;
        if ((command == GIP_AUTH || command == GIP_FINAL_AUTH) && !in->getChunked() &&
            in->getDataLength() == sizeof(authReady) && memcmp(in->getData(), authReady, sizeof(authReady)) == 0) {
            authCompleted = true;
            drvState = AUTH_DONE;
        }
        relay_packet_t p;
        p.len = bytes > 64 ? 64 : (uint16_t)bytes;
        memcpy(p.data, epout_buf, p.len);
        queue_try_add(&relayToDevice, &p);
        in->reset();
        usbd_edpt_xfer(rhport, ep_out, epout_buf, sizeof(epout_buf));
        return true;
    }

    if (in->ackRequired()) queue_report(in->generateAckPacket(), in->getPacketLength());

    if (command == GIP_ACK_RESPONSE) {
        waiting_ack = false;
    } else if (command == GIP_DEVICE_DESCRIPTOR) {
        load_descriptor_reply(in->getSequence());
    } else if (command == GIP_CMD_LED_ON) {
        if (drvState == WAIT_DESCRIPTOR_REQUEST) load_descriptor_reply(in->getSequence());
    } else if (command == GIP_AUTH || command == GIP_FINAL_AUTH) {
        if (in->getDataLength() == 2 && memcmp(in->getData(), authReady, sizeof(authReady)) == 0) {
            authCompleted = true;
            drvState = AUTH_DONE;
        }
        if (!in->getChunked() || in->endOfChunk()) {
            buf_set(&consoleBuffer, in->getData(), in->getDataLength(), in->getSequence(), in->getCommand());
            xboneState = CONSOLE_TO_DONGLE;
            in->reset();
        }
    }
    usbd_edpt_xfer(rhport, ep_out, epout_buf, sizeof(epout_buf));
    return true;
}

// Windows asks for the "XGIP10" compatible id; consoles don't need anything here
bool xbone_dev_control(uint8_t rhport, uint8_t stage, tusb_control_request_t const *req) {
    static const uint8_t compat[40] = {40, 0, 0, 0, 0x00, 0x01, 0x04, 0x00, 1, 0, 0, 0, 0, 0, 0, 0,
                                       0, 1, 'X', 'G', 'I', 'P', '1', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    static uint8_t buf[64];
    if (stage != CONTROL_STAGE_SETUP) return true;
    if (req->bmRequestType_bit.direction == TUSB_DIR_IN) {
        uint16_t n = req->wLength;
        if (req->bRequest == 0x20 && req->wIndex == 0x0004) {
            if (n > sizeof(compat)) n = sizeof(compat);
            return tud_control_xfer(rhport, req, (void *)compat, n);
        }
        memset(buf, 0, sizeof(buf));
        if (n > sizeof(buf)) n = sizeof(buf);
        return tud_control_xfer(rhport, req, buf, n);
    }
    if (req->wLength == 0) return tud_control_status(rhport, req);
    return tud_control_xfer(rhport, req, buf, req->wLength > sizeof(buf) ? sizeof(buf) : req->wLength);
}

// ---------------------------------------------------------------- host side
static uint8_t x_dev = 0, x_inst = 0;
static bool x_mounted, heard_from_device, init_kicked, relay_manufacturer, dongle_detected;
static uint32_t mount_time, last_host_send;
static XGIPProtocol hostIn, hostChunkIn, hostOut;
static relay_packet_t hq[QDEPTH];
static uint8_t hq_head, hq_count;
static uint8_t manufacturer_desc[64];

static void host_queue(const uint8_t *r, uint16_t len) {
    if (hq_count == QDEPTH || len > 64) return;
    uint8_t i = (uint8_t)((hq_head + hq_count) % QDEPTH);
    memcpy(hq[i].data, r, len);
    hq[i].len = len;
    hq_count++;
}

static void update_path(void) { passthrough_enabled = relay_manufacturer || !dongle_detected; }

static void manufacturer_cb(tuh_xfer_t *xfer) {
    if (xfer->result != XFER_RESULT_SUCCESS || xfer->actual_len < 2) return;
    static const char *const names[] = {"Microsoft", "Brook", "PowerA"};
    uint16_t len = manufacturer_desc[0] < xfer->actual_len ? manufacturer_desc[0] : (uint16_t)xfer->actual_len;
    uint16_t chars = len > 2 ? (len - 2) / 2 : 0;
    for (const char *name : names) {
        size_t n = strlen(name);
        if (chars < n) continue;
        bool match = true;
        for (size_t i = 0; i < n && match; i++) match = manufacturer_desc[2 + i * 2] == (uint8_t)name[i] && manufacturer_desc[3 + i * 2] == 0;
        if (match) { relay_manufacturer = true; update_path(); return; }
    }
}

void xbone_host_mount(uint8_t dev_addr, uint8_t instance) {
    x_dev = dev_addr; x_inst = instance;
    hostIn.reset(); hostChunkIn.reset(); hostOut.reset();
    uint16_t vid = 0, pid = 0;
    tuh_vid_pid_get(dev_addr, &vid, &pid);
    relay_manufacturer = false;
    dongle_detected = vid == 0x0079;           // MagicBoots-family dongles
    update_path();
    passthrough = false;
    heard_from_device = init_kicked = false;
    mount_time = now_ms();
    x_mounted = true;
    deviceMounted = true;
    if (consoleAuthOrphaned && !authCompleted) reconnectRequested = true;   // console gave up: make it start over
    memset(manufacturer_desc, 0, sizeof(manufacturer_desc));
    tuh_descriptor_get_manufacturer_string(dev_addr, 0x0409, manufacturer_desc, sizeof(manufacturer_desc), manufacturer_cb, 0);
}

void xbone_host_unmount(uint8_t dev_addr) {
    if (dev_addr != x_dev) return;
    x_mounted = false;
    deviceMounted = false;
    hq_head = hq_count = 0;
    hostIn.reset(); hostChunkIn.reset(); hostOut.reset();
    passthrough_enabled = passthrough = false;
    relay_packet_t p;
    while (queue_try_remove(&relayToDevice, &p)) {}
    while (queue_try_remove(&relayToConsole, &p)) {}
    dongle_ready = false;
}

void xbone_host_report(uint8_t dev_addr, uint8_t instance, const uint8_t *report, uint16_t len) {
    if (!x_mounted || dev_addr != x_dev || instance != x_inst) return;
    if (passthrough && xbone_is_auth_packet(report, len)) {
        relay_packet_t p;
        p.len = len > 64 ? 64 : len;
        memcpy(p.data, report, p.len);
        queue_try_add(&relayToConsole, &p);
        return;
    }
    XGIPProtocol &in = gip_is_fragment(report, len) ? hostChunkIn : hostIn;   // see inChunkXGIP
    in.parse(report, len);
    if (!in.validate()) { in.reset(); return; }
    heard_from_device = true;
    if (in.ackRequired()) host_queue(in.generateAckPacket(), in.getPacketLength());

    switch (in.getCommand()) {
        case GIP_ANNOUNCE:
            if (in.getDataLength() >= 12) {
                uint16_t avid = in.getData()[8] | (in.getData()[9] << 8);
                if (avid == 0x33DF) { dongle_detected = true; update_path(); }   // Mayflash
            }
            hostOut.reset();
            hostOut.setAttributes(GIP_DEVICE_DESCRIPTOR, 1, 1, false, 0);
            host_queue(hostOut.generatePacket(), hostOut.getPacketLength());
            break;
        case GIP_DEVICE_DESCRIPTOR:
            if (in.endOfChunk() && !dongle_ready) {
                hostOut.reset(); hostOut.setAttributes(GIP_POWER_MODE_DEVICE_CONFIG, 2, 1, false, 0);
                hostOut.setData(XBOXONE_POWER_ON, sizeof(XBOXONE_POWER_ON));
                host_queue(hostOut.generatePacket(), hostOut.getPacketLength());
                hostOut.reset(); hostOut.setAttributes(GIP_POWER_MODE_DEVICE_CONFIG, 3, 1, false, 0);
                hostOut.setData(XBOXONE_POWER_ON_SINGLE, sizeof(XBOXONE_POWER_ON_SINGLE));
                host_queue(hostOut.generatePacket(), hostOut.getPacketLength());
                hostOut.reset(); hostOut.setAttributes(GIP_CMD_LED_ON, 1, 0, false, 0);
                hostOut.setData(XBOXONE_LED_ON, sizeof(XBOXONE_LED_ON));
                host_queue(hostOut.generatePacket(), hostOut.getPacketLength());
                hostOut.reset(); hostOut.setAttributes(GIP_CMD_RUMBLE, 1, 0, false, 0);
                hostOut.setData(XBOXONE_RUMBLE_ON, sizeof(XBOXONE_RUMBLE_ON));
                host_queue(hostOut.generatePacket(), hostOut.getPacketLength());
                dongle_ready = true;
            }
            break;
        case GIP_AUTH:
        case GIP_FINAL_AUTH:
            if (!in.getChunked() || in.endOfChunk()) {
                buf_set(&dongleBuffer, in.getData(), in.getDataLength(), in.getSequence(), in.getCommand());
                xboneState = DONGLE_TO_CONSOLE;
                in.reset();
            }
            break;
        default:
            break;
    }
}

static void host_process(void) {
    if (!x_mounted) return;
    // Some pads never announce: ask for the descriptor ourselves so they power on
    if (!heard_from_device && !init_kicked && now_ms() - mount_time > 250) {
        init_kicked = true;
        static const uint8_t req[] = {GIP_DEVICE_DESCRIPTOR, 0x20, 0x01, 0x00};
        host_queue(req, sizeof(req));
    }
    if (passthrough) {
        relay_packet_t p;
        while (queue_try_peek(&relayToDevice, &p)) {
            if (!tuh_xinput_send_report(x_dev, x_inst, p.data, p.len)) return;
            queue_try_remove(&relayToDevice, &p);
        }
    } else if (xboneState == CONSOLE_TO_DONGLE && consoleBuffer.set) {
        // reassembled path (dongles): re-chunk the console's message for the dongle
        bool chunked = consoleBuffer.length > GIP_MAX_CHUNK_SIZE;
        hostOut.reset();
        hostOut.setAttributes(consoleBuffer.type, consoleBuffer.sequence, 1, chunked, consoleBuffer.length > 2);
        hostOut.setData(consoleBuffer.data, consoleBuffer.length);
        buf_reset(&consoleBuffer);
        xboneState = WAIT_CONSOLE_TO_DONGLE;
    }
    if (xboneState == WAIT_CONSOLE_TO_DONGLE && hq_count < QDEPTH) {
        host_queue(hostOut.generatePacket(), hostOut.getPacketLength());
        if (!hostOut.getChunked() || hostOut.endOfChunk()) xboneState = AUTH_IDLE;
    }
    if (hq_count && now_ms() - last_host_send > 15) {
        if (tuh_xinput_send_report(x_dev, x_inst, hq[hq_head].data, hq[hq_head].len)) {
            hq_head = (uint8_t)((hq_head + 1) % QDEPTH);
            hq_count--;
            last_host_send = now_ms();
        }
    }
}

// ---------------------------------------------------------------- main loop
static void set_ack_wait(void) { waiting_ack = true; waiting_ack_since = now_ms(); }

static void device_update(uint32_t now) {
    // send queued packets (fast while relaying auth, otherwise spaced out)
    if (txq_count && (passthrough || now - last_queue_send > 35)) {
        if (send_usb(txq[txq_head].data, txq[txq_head].len)) {
            txq_head = (uint8_t)((txq_head + 1) % QDEPTH);
            txq_count--;
            last_queue_send = now;
        }
    }

    // late plug-in of the auth controller: soft reconnect so the console restarts authentication
    static uint32_t reconnect_at = 0;
    if (reconnectRequested) {
        reconnectRequested = false;
        consoleAuthOrphaned = false;
        buf_reset(&consoleBuffer); buf_reset(&dongleBuffer);
        xboneState = AUTH_IDLE;
        passthrough = false;
        drvState = NOT_READY;
        waiting_ack = false;
        tud_disconnect();
        reconnect_at = now + 250;
    }
    if (reconnect_at && (int32_t)(now - reconnect_at) >= 0) { reconnect_at = 0; tud_connect(); }

    host_process();
    relay_packet_t p;
    while (txq_count < QDEPTH && queue_try_remove(&relayToConsole, &p)) queue_report(p.data, p.len);

    if (waiting_ack) {
        if (now - waiting_ack_since < 2000) return;
        waiting_ack = false;
    }
    switch (drvState) {
        case READY_ANNOUNCE:
            if (now - announce_timer > 500) {
                uint8_t a[sizeof(announce_guitar)];
                memcpy(a, announce_guitar, sizeof(a));
                pico_unique_board_id_t id;
                pico_get_unique_board_id(&id);
                memcpy(&a[3], &id.id[PICO_UNIQUE_BOARD_ID_SIZE_BYTES - 3], 3);   // stable per-board "MAC"
                outXGIP->reset();
                outXGIP->setAttributes(GIP_ANNOUNCE, 1, 1, 0, 0);
                outXGIP->setData(a, sizeof(a));
                queue_report(outXGIP->generatePacket(), outXGIP->getPacketLength());
                drvState = WAIT_DESCRIPTOR_REQUEST;
            }
            break;
        case SEND_DESCRIPTOR:
            if (txq_count >= QDEPTH) break;
            queue_report(outXGIP->generatePacket(), outXGIP->getPacketLength());
            if (outXGIP->endOfChunk()) drvState = SETUP_AUTH;
            if (outXGIP->getPacketAck()) set_ack_wait();
            break;
        case SETUP_AUTH:
            if (xboneState == DONGLE_TO_CONSOLE && dongleBuffer.set) {
                uint16_t len = dongleBuffer.length;
                outXGIP->reset();
                outXGIP->setAttributes(dongleBuffer.type, dongleBuffer.sequence, 1, len > GIP_MAX_CHUNK_SIZE, 1);
                outXGIP->setData(dongleBuffer.data, len);
                xboneState = WAIT_DONGLE_TO_CONSOLE;
                buf_reset(&dongleBuffer);
            }
            if (xboneState == WAIT_DONGLE_TO_CONSOLE && txq_count < QDEPTH) {
                queue_report(outXGIP->generatePacket(), outXGIP->getPacketLength());
                if (!outXGIP->getChunked() || outXGIP->endOfChunk()) xboneState = AUTH_IDLE;
                if (outXGIP->getPacketAck()) set_ack_wait();
            }
            break;
        default:
            break;
    }
}

bool xbone_authenticated(void) { return authCompleted; }

void xbone_task(const uint8_t *payload, bool guide) {
    if (!inXGIP) return;
    uint32_t now = now_ms();
    device_update(now);
    if (!authCompleted || ep_in == 0 || txq_count) return;   // nothing but protocol traffic until authenticated

    uint8_t pkt[4 + XBONE_GUITAR_PAYLOAD_LEN];
    if (now - keep_alive_timer > 15000) {               // keep-alive every 15 s
        static const uint8_t ka[] = {0x80, 0x00, 0x00, 0x00};
        pkt[0] = GIP_KEEPALIVE; pkt[1] = 0x20; pkt[2] = keep_alive_seq; pkt[3] = sizeof(ka);
        memcpy(&pkt[4], ka, sizeof(ka));
        if (send_usb(pkt, 4 + sizeof(ka))) {
            keep_alive_timer = now;
            if (++keep_alive_seq == 0) keep_alive_seq = 1;
        }
        return;
    }
    if (guide != guide_down) {                          // the guide button travels as a virtual keycode
        uint8_t seq = (uint8_t)(keycode_seq + 1); if (seq == 0) seq = 1;
        pkt[0] = GIP_VIRTUAL_KEYCODE; pkt[1] = 0x20; pkt[2] = seq; pkt[3] = 2;
        memcpy(&pkt[4], guide ? xb1_guide_on : xb1_guide_off, 2);
        if (send_usb(pkt, 6)) { keycode_seq = seq; guide_down = guide; }
        return;
    }
    if (have_last && memcmp(last_payload, payload, XBONE_GUITAR_PAYLOAD_LEN) == 0) return;
    uint8_t seq = (uint8_t)(report_seq + 1); if (seq == 0) seq = 1;
    pkt[0] = GIP_INPUT_REPORT; pkt[1] = 0x00; pkt[2] = seq; pkt[3] = XBONE_GUITAR_PAYLOAD_LEN;
    memcpy(&pkt[4], payload, XBONE_GUITAR_PAYLOAD_LEN);
    if (send_usb(pkt, sizeof(pkt))) {
        report_seq = seq;
        memcpy(last_payload, payload, XBONE_GUITAR_PAYLOAD_LEN);
        have_last = true;
    }
}
