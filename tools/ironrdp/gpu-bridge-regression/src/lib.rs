//! Exercises the actual web graphics handler through the public EGFX channel.

mod gpu;

use ironrdp_dvc::DvcProcessor;
use ironrdp_egfx::client::{BitmapUpdate, GraphicsPipelineClient, GraphicsPipelineHandler};
use ironrdp_egfx::pdu::{
    Codec1Type, CreateSurfacePdu, EndFramePdu, GfxPdu, MapSurfaceToOutputPdu,
    PixelFormat, ResetGraphicsPdu, WireToSurface1Pdu,
};
use ironrdp_pdu::geometry::ExclusiveRectangle;
use wasm_bindgen::prelude::*;

struct BitmapOnly;

impl GraphicsPipelineHandler for BitmapOnly {
    fn on_bitmap_updated(&mut self, update: &BitmapUpdate) {
        gpu::WebGraphicsHandler.on_bitmap_updated(update);
    }
}

fn send(client: &mut GraphicsPipelineClient, pdu: GfxPdu) {
    let bytes = ironrdp_core::encode_vec(&pdu).expect("fixture PDU encodes");
    client.process(0, &ironrdp_graphics::zgfx::wrap_uncompressed(&bytes)).expect("fixture PDU processes");
}

fn prepare(client: &mut GraphicsPipelineClient) {
    send(client, GfxPdu::ResetGraphics(ResetGraphicsPdu { width: 8, height: 6, monitors: vec![] }));
    send(client, GfxPdu::CreateSurface(CreateSurfacePdu {
        surface_id: 9, width: 8, height: 6, pixel_format: PixelFormat::XRgb,
    }));
}

fn bitmap(client: &mut GraphicsPipelineClient) {
    // oracle: Uncompressed wire pixels are BGRX, and the public handler receives
    // complete RGBA with opaque alpha and an exclusive destination rectangle.
    send(client, GfxPdu::WireToSurface1(WireToSurface1Pdu {
        surface_id: 9,
        destination_rectangle: ExclusiveRectangle { left: 2, top: 3, right: 4, bottom: 4 },
        codec_id: Codec1Type::Uncompressed,
        bitmap_data: vec![51, 34, 17, 0, 102, 85, 68, 0],
        pixel_format: PixelFormat::XRgb,
    }));
}

#[wasm_bindgen]
pub fn emit_bitmap() {
    let mut client = GraphicsPipelineClient::new(Box::new(BitmapOnly), None);
    prepare(&mut client);
    bitmap(&mut client);
}

#[wasm_bindgen]
pub fn emit_bootstrap() {
    let mut client = GraphicsPipelineClient::new(Box::new(gpu::WebGraphicsHandler), None);
    prepare(&mut client);
    send(&mut client, GfxPdu::MapSurfaceToOutput(MapSurfaceToOutputPdu {
        surface_id: 9, output_origin_x: 1, output_origin_y: 2,
    }));
    bitmap(&mut client);
    send(&mut client, GfxPdu::EndFrame(EndFramePdu { frame_id: 7 }));
    client.close(0);
}

#[wasm_bindgen]
pub fn externally_composited() -> bool {
    gpu::WebGraphicsHandler.externally_composited()
}
