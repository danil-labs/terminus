//! The Terminus window. It is a client of an external engine (`seldon-runtime`)
//! selected at launch; the domain lives in the engine, not here.

mod extracted;
pub use extracted::{env, run, util};
pub use extracted::{launch, stop_engine};
