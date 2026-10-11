from .base import Agent, Ctx  # noqa
from .ingest import SourceScout, Ingestion, Extractor
from .enrich import Classifier, EntityRelation, DedupCluster, Translator
from .analysis import StorylineBuilder, PatternAnomaly, Verifier
from .output import AnalystWriter, VizDirector, QAEvaluator

PIPELINE = [SourceScout, Ingestion, Extractor, Classifier, EntityRelation, DedupCluster, Translator,
            StorylineBuilder, PatternAnomaly, Verifier, AnalystWriter, VizDirector, QAEvaluator]
REGISTRY = {a.name: a for a in PIPELINE}
