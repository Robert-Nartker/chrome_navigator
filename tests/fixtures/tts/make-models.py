# Builds the tiny ONNX models the voice lab e2e tests serve in place of real voice models
# (the real ones are 60-330 MB). The voice-shaped ones output a short 440 Hz tone, so a test can
# check that the vendored ONNX Runtime builds load, run a model, and play audio in the extension.
#   pip install onnx && python3 tests/fixtures/tts/make-models.py
import math
import os

import onnx
from onnx import TensorProto, helper

HERE = os.path.dirname(os.path.abspath(__file__))


def model(nodes, inputs, outputs, initializer):
    graph = helper.make_graph(nodes, "tiny", inputs, outputs, initializer=initializer)
    # Opset 13 / IR 8 load in every ONNX Runtime version the lab ships (1.18 and newer).
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    onnx.checker.check_model(m)
    return m


def scalar(name, value):
    return helper.make_tensor(name, TensorProto.FLOAT, [], [value])


def tone(inputs, output, sample_rate, seconds=0.3):
    """Ignores its inputs and returns a quiet sine tone."""
    return model(
        [
            helper.make_node("Range", ["start", "limit", "delta"], ["t"]),
            helper.make_node("Mul", ["t", "step"], ["phase"]),
            helper.make_node("Sin", ["phase"], ["wave"]),
            helper.make_node("Mul", ["wave", "level"], [output]),
        ],
        inputs,
        [helper.make_tensor_value_info(output, TensorProto.FLOAT, ["samples"])],
        [
            scalar("start", 0.0),
            scalar("limit", float(int(sample_rate * seconds))),
            scalar("delta", 1.0),
            scalar("step", 2 * math.pi * 440 / sample_rate),
            scalar("level", 0.1),
        ],
    )


def save(m, name):
    onnx.save(m, os.path.join(HERE, name))


# y = 2x + 1, for running a vendored runtime directly.
save(
    model(
        [helper.make_node("Mul", ["x", "two"], ["x2"]), helper.make_node("Add", ["x2", "one"], ["y"])],
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [3])],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [3])],
        [scalar("two", 2.0), scalar("one", 1.0)],
    ),
    "double.onnx",
)

# The inputs and output of a Kokoro model.
save(
    tone(
        [
            helper.make_tensor_value_info("input_ids", TensorProto.INT64, [1, "tokens"]),
            helper.make_tensor_value_info("style", TensorProto.FLOAT, [1, 256]),
            helper.make_tensor_value_info("speed", TensorProto.FLOAT, [1]),
        ],
        "waveform",
        24000,
    ),
    "kokoro-tone.onnx",
)

# The inputs and output of a Piper voice.
save(
    tone(
        [
            helper.make_tensor_value_info("input", TensorProto.INT64, [1, "phonemes"]),
            helper.make_tensor_value_info("input_lengths", TensorProto.INT64, [1]),
            helper.make_tensor_value_info("scales", TensorProto.FLOAT, [3]),
        ],
        "output",
        22050,
    ),
    "piper-tone.onnx",
)
