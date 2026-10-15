"""Server-only envelope encryption for an account's Toss statement password."""
import base64
import hashlib
import os
import re

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from api.firebase_credential import parse_firebase_credential


def _key():
    credential = parse_firebase_credential(os.environ.get('FIRESTORE_SA_KEY'))
    return serialization.load_pem_private_key(credential['private_key'].encode(), password=None)


def seal_password(password, scope):
    if not isinstance(password, str) or not re.fullmatch(r'\d{6}', password, re.ASCII):
        raise ValueError('토스 PDF 비밀번호는 생년월일 6자리로 입력하세요.')
    private = _key()
    data_key, nonce = AESGCM.generate_key(bit_length=256), os.urandom(12)
    wrapped = private.public_key().encrypt(data_key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=scope.encode()))
    encode = lambda value: base64.b64encode(value).decode('ascii')
    public = private.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return {'version': 1, 'keyId': hashlib.sha256(public).hexdigest()[:24],
            'wrappedKey': encode(wrapped), 'nonce': encode(nonce),
            'ciphertext': encode(AESGCM(data_key).encrypt(nonce, password.encode(), scope.encode()))}


def open_password(envelope, scope):
    if envelope.get('version') != 1:
        raise ValueError('지원하지 않는 암호 형식입니다.')
    decode = lambda key: base64.b64decode(envelope[key], validate=True)
    key = _key().decrypt(decode('wrappedKey'), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=scope.encode()))
    return AESGCM(key).decrypt(decode('nonce'), decode('ciphertext'), scope.encode()).decode()
