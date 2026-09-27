import os
import tempfile

from flask import Flask, request, jsonify, make_response

try:
    # 패키지 컨텍스트 (서버리스 환경 등)
    from .toss_extractor import extract_transactions_from_pdf
except ImportError:  # pragma: no cover - 로컬 직접 실행 대비
    # 모듈 단독 실행 시 경로 보정
    from toss_extractor import extract_transactions_from_pdf

app = Flask(__name__)


def _apply_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/parsePdfTransaction", methods=["POST", "OPTIONS"])
def parse_pdf_transaction():
    if request.method == "OPTIONS":
        return _apply_cors(make_response("", 204))

    if request.method != "POST":
        return _apply_cors(jsonify({"error": "Method not allowed"})), 405

    upload = request.files.get("file")
    brokerage = request.form.get("brokerage")

    if upload is None or upload.filename == "":
        return _apply_cors(jsonify({"error": "파일이 없습니다."})), 400

    if not brokerage:
        return _apply_cors(jsonify({"error": "증권사 정보가 없습니다."})), 400

    suffix = os.path.splitext(upload.filename)[1] or ".pdf"
    temp_file_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            upload.save(tmp.name)
            temp_file_path = tmp.name

        if brokerage == "toss":
            app.logger.info("토스 거래내역서 파싱 시작")
            result = extract_transactions_from_pdf(temp_file_path, verbose=False)
            app.logger.info(
                "토스 거래내역서 파싱 완료: 거래수=%s",
                result.get("total_count"),
            )
        else:
            return _apply_cors(jsonify({"error": "지원하지 않는 증권사입니다."})), 400

        return _apply_cors(jsonify(result))
    except Exception as exc:
        app.logger.exception("PDF 파싱 오류")
        return _apply_cors(
            jsonify(
                {
                    "error": "PDF 파싱에 실패했습니다.",
                    "details": str(exc),
                }
            )
        ), 500
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError:
                app.logger.warning("임시 파일 삭제 실패: %s", temp_file_path)


