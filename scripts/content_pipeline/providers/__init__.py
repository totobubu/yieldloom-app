"""Official distribution source adapters."""

from .base import CollectionError, FetchOutcome, NoDataError, ProviderAdapter, SourceCandidate
from .amplify import AmplifyAdapter
from .defiance import DefianceAdapter
from .globalx import GlobalXAdapter
from .firsttrust import FirstTrustAdapter
from .graniteshares import GraniteSharesAdapter
from .ishares import ISharesAdapter
from .jpmorgan import JPMorganAdapter
from .kurv import KurvAdapter
from .neos import NeosAdapter
from .proshares import ProSharesAdapter
from .rex import RexAdapter
from .roundhill import RoundhillAdapter
from .schwab import SchwabAdapter
from .statestreet import StateStreetAdapter
from .yieldmax import YieldMaxAdapter

PROVIDERS = {
    "amplify": AmplifyAdapter,
    "yieldmax": YieldMaxAdapter,
    "roundhill": RoundhillAdapter,
    "rex": RexAdapter,
    "jpmorgan": JPMorganAdapter,
    "schwab": SchwabAdapter,
    "neos": NeosAdapter,
    "defiance": DefianceAdapter,
    "globalx": GlobalXAdapter,
    "firsttrust": FirstTrustAdapter,
    "graniteshares": GraniteSharesAdapter,
    "ishares": ISharesAdapter,
    "kurv": KurvAdapter,
    "proshares": ProSharesAdapter,
    "statestreet": StateStreetAdapter,
}

__all__ = [
    "ProviderAdapter",
    "CollectionError",
    "FetchOutcome",
    "NoDataError",
    "SourceCandidate",
    "AmplifyAdapter",
    "YieldMaxAdapter",
    "RoundhillAdapter",
    "RexAdapter",
    "JPMorganAdapter",
    "SchwabAdapter",
    "NeosAdapter",
    "DefianceAdapter",
    "GlobalXAdapter",
    "FirstTrustAdapter",
    "GraniteSharesAdapter",
    "ISharesAdapter",
    "KurvAdapter",
    "ProSharesAdapter",
    "StateStreetAdapter",
    "PROVIDERS",
]
